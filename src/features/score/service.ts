import { createHash } from "node:crypto";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { checkWeek } from "../../server/validation";
import { audit } from "../fleet/service";
import type { ScoreRow } from "./parser";
import { storeBytes, removeBytes } from "../uploads/storage";
import { parseIsolated } from "./isolated-parser";
import type { Prisma } from "../../generated/prisma/client";
type Tx = Prisma.TransactionClient;
async function authorize(tx: Tx, p: Principal) {
  demand(p, "score-imports", "write");
  const membership = await tx.membership.findFirst({
    where: {
      organizationId: p.organizationId,
      userId: p.userId,
      active: true,
      role: { in: ["ADMIN", "SUPER_ADMIN"] },
    },
  });
  if (!membership)
    throw new AppError(403, "Der Administrationszugang ist nicht mehr aktiv.");
}
export async function scoreHistory(p: Principal) {
  demand(p, "score-imports", "read");
  return {
    items: await database().scoreImport.findMany({
      where: { organizationId: p.organizationId },
      select: {
        id: true,
        week: true,
        filename: true,
        status: true,
        createdAt: true,
        committedAt: true,
        previousId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  };
}
export async function previewScore(p: Principal, form: FormData) {
  demand(p, "score-imports", "write");
  const file = form.get("file");
  if (!(file instanceof File))
    throw new AppError(422, "Bitte eine Datei auswählen.");
  const week = checkWeek(String(form.get("week") ?? ""));
  let mapping: Record<string, string> = {};
  try {
    const raw = form.get("mapping");
    if (raw) {
      const v = JSON.parse(String(raw));
      if (
        !v ||
        Array.isArray(v) ||
        typeof v !== "object" ||
        Object.values(v).some((x) => typeof x !== "string")
      )
        throw Error();
      mapping = v;
    }
  } catch {
    throw new AppError(422, "Spaltenzuordnung muss ein JSON-Objekt sein.");
  }
  if (file.size > 5 * 1024 * 1024)
    throw new AppError(413, "Die Datei ist zu groß.");
  const data = new Uint8Array(await file.arrayBuffer());
  const drivers = await database().driverProfile.findMany({
    where: { organizationId: p.organizationId },
    select: {
      id: true,
      email: true,
      transporterId: true,
      firstName: true,
      lastName: true,
    },
  });
  const driverNames = Object.fromEntries(
    drivers.map((d) => [d.id, `${d.firstName} ${d.lastName}`]),
  );
  const preview = await parseIsolated(data, file.name, week, mapping, drivers);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        week,
        rows: preview.rows,
        errors: preview.errors,
        mapping: preview.mapping,
      }),
    )
    .digest("hex");
  const sourceKey = await storeBytes(data, "application/octet-stream");
  let retained = false,
    created = false;
  try {
    const result = await database().$transaction(async (tx) => {
      await authorize(tx, p);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${p.organizationId + ":score:" + week},0))`;
      const duplicate = await tx.scoreImport.findFirst({
        where: {
          organizationId: p.organizationId,
          week,
          hash,
          status: { in: ["DRAFT", "COMMITTED"] },
        },
      });
      if (duplicate) {
        if (duplicate.status === "COMMITTED")
          throw new AppError(409, "Diese Daten wurden bereits importiert.");
        return { id: duplicate.id, ...preview, driverNames };
      }
      const item = await tx.scoreImport.create({
        data: {
          organizationId: p.organizationId,
          sourceKey,
          sourceHash: createHash("sha256").update(data).digest("hex"),
          week,
          filename: file.name.replace(/[\x00-\x1f]/g, "").slice(0, 200),
          hash,
          mapping: preview.mapping,
          rows: preview.rows as unknown as Prisma.InputJsonValue,
          errors: preview.errors,
          createdBy: p.userId,
        },
      });
      await audit(tx, p, "preview", "score-import", item.id);
      created = true;
      return { id: item.id, ...preview, driverNames };
    });
    retained = created;
    return result;
  } finally {
    if (!retained) await removeBytes(sourceKey);
  }
}
export async function changeScoreImport(
  p: Principal,
  id: string,
  action: unknown,
) {
  demand(p, "score-imports", "write");
  if (!["commit", "revert"].includes(String(action)) || !id || id.length > 100)
    throw new AppError(422, "Ungültige Importaktion.");
  return database().$transaction(
    async (tx) => {
      await authorize(tx, p);
      const first = await tx.scoreImport.findFirst({
        where: { id, organizationId: p.organizationId },
      });
      if (!first) throw new AppError(404, "Import nicht gefunden.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${p.organizationId + ":score:" + first.week},0))`;
      const item = await tx.scoreImport.findFirstOrThrow({
        where: { id, organizationId: p.organizationId },
      });
      if (action === "commit") {
        if (item.status !== "DRAFT")
          throw new AppError(409, "Nur ein Entwurf kann übernommen werden.");
        if (
          !Array.isArray(item.errors) ||
          item.errors.length ||
          !Array.isArray(item.rows) ||
          !item.rows.length
        )
          throw new AppError(422, "Bitte zuerst alle Importfehler beheben.");
        const rows = item.rows as unknown as ScoreRow[];
        const ids = rows.map((r) => r.driverId);
        if (
          new Set(ids).size !== ids.length ||
          rows.some((r) => r.week !== item.week)
        )
          throw new AppError(409, "Ungültige Importdaten.");
        const count = await tx.driverProfile.count({
          where: { organizationId: p.organizationId, id: { in: ids } },
        });
        if (count !== ids.length)
          throw new AppError(
            409,
            "Die Fahrerzuordnung hat sich geändert. Bitte erneut importieren.",
          );
        const current = await tx.scoreImport.findFirst({
          where: {
            organizationId: p.organizationId,
            week: item.week,
            status: "COMMITTED",
          },
        });
        if (current?.hash === item.hash)
          throw new AppError(409, "Diese Daten sind bereits aktiv.");
        if (current)
          await tx.scoreImport.update({
            where: { id: current.id },
            data: { status: "SUPERSEDED" },
          });
        await tx.driverScore.createMany({
          data: rows.map((r) => ({
            ...r,
            organizationId: p.organizationId,
            importId: id,
            metrics: r.metrics,
          })),
        });
        await tx.scoreImport.update({
          where: { id },
          data: {
            status: "COMMITTED",
            committedAt: new Date(),
            previousId: current?.id ?? null,
          },
        });
      } else {
        if (item.status !== "COMMITTED")
          throw new AppError(
            409,
            "Nur der aktuell aktive Import kann zurückgenommen werden.",
          );
        await tx.scoreImport.update({
          where: { id },
          data: { status: "REVERTED" },
        });
        if (item.previousId) {
          const previous = await tx.scoreImport.findFirst({
            where: {
              id: item.previousId,
              organizationId: p.organizationId,
              week: item.week,
              status: "SUPERSEDED",
            },
          });
          if (!previous)
            throw new AppError(409, "Vorherige Revision ist nicht verfügbar.");
          await tx.scoreImport.update({
            where: { id: previous.id },
            data: { status: "COMMITTED" },
          });
        }
      }
      await audit(tx, p, String(action), "score-import", id);
      return { ok: true, id };
    },
    { isolationLevel: "Serializable" },
  );
}
