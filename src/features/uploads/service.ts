import sharp from "sharp";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { validateUpload } from "./policy";
import { scanPdf, storeBytes, retrieveBytes, removeBytes } from "./storage";
import { audit } from "../fleet/service";
/** A ready object is created only after validation and private byte storage succeed. */
export async function upload(p: Principal, form: FormData) {
  const kind = String(form.get("kind"));
  if (!["photo", "document"].includes(kind))
    throw new AppError(422, "Upload-Typ ungültig.");
  demand(p, kind === "photo" ? "photos" : "documents", "write");
  const vehicleId = String(form.get("vehicleId") ?? "") || null,
    driverId = String(form.get("driverId") ?? "") || null;
  const title = String(form.get("title") ?? "")
      .trim()
      .slice(0, 160),
    notes = String(form.get("notes") ?? "").slice(0, 2000);
  const files = form
    .getAll("files")
    .filter((f): f is File => typeof f !== "string");
  if (!files.length || files.length > (kind === "photo" ? 20 : 1))
    throw new AppError(422, "Bitte eine passende Anzahl Dateien auswählen.");
  if (kind === "photo" && !vehicleId)
    throw new AppError(422, "Bitte ein Fahrzeug auswählen.");
  if (
    kind === "document" &&
    (!title || Number(!!vehicleId) + Number(!!driverId) !== 1)
  )
    throw new AppError(
      422,
      "Bitte Titel und genau einen Fahrer oder ein Fahrzeug angeben.",
    );
  const replacesId = String(form.get("replacesId") ?? "") || null;
  const db = database();
  if (
    driverId &&
    !(await db.driverProfile.count({
      where: { id: driverId, organizationId: p.organizationId },
    }))
  )
    throw new AppError(404, "Fahrer nicht gefunden.");
  if (
    vehicleId &&
    !(await db.vehicle.count({
      where: { id: vehicleId, organizationId: p.organizationId },
    }))
  )
    throw new AppError(404, "Fahrzeug nicht gefunden.");
  if (p.role === "DRIVER") {
    if (kind === "document" && driverId !== p.driverId)
      throw new AppError(
        403,
        "Nur eigene Dokumente können hochgeladen werden.",
      );
    if (
      kind === "photo" &&
      !(await db.vehicleAssignment.count({
        where: {
          organizationId: p.organizationId,
          driverId: p.driverId!,
          vehicleId: vehicleId!,
          endAt: null,
        },
      }))
    )
      throw new AppError(403, "Das Fahrzeug ist Ihnen nicht zugewiesen.");
  }
  if (p.role === "DISPATCHER" && driverId)
    throw new AppError(403, "Keine Berechtigung für Personaldokumente.");
  const expiresRaw = String(form.get("expiresAt") ?? "");
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && !Number.isFinite(expiresAt.getTime()))
    throw new AppError(422, "Ungültiges Ablaufdatum.");
  const objects: {
    key: string;
    filename: string;
    mime: string;
    size: number;
  }[] = [];
  try {
    for (const file of files) {
      let bytes = new Uint8Array(await file.arrayBuffer());
      const type = validateUpload(file.name, file.type, bytes);
      if (kind === "photo" && type !== "image")
        throw new AppError(422, "Fotoberichte benötigen Bilddateien.");
      let mime = file.type,
        filename = file.name;
      if (type === "image") {
        const image = sharp(bytes, {
          failOn: "warning",
          limitInputPixels: 25000000,
          pages: 1,
        });
        const meta = await image.metadata();
        if (
          !["jpeg", "png"].includes(meta.format ?? "") ||
          (meta.pages ?? 1) > 1
        )
          throw new AppError(422, "Dieses Bildformat ist nicht erlaubt.");
        bytes = new Uint8Array(
          await image
            .rotate()
            .resize({
              width: 2400,
              height: 2400,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 85 })
            .toBuffer(),
        );
        mime = "image/jpeg";
        filename = file.name.replace(/\.[^.]+$/, ".jpg");
      } else await scanPdf(bytes);
      objects.push({
        key: await storeBytes(bytes, mime),
        filename,
        mime,
        size: bytes.length,
      });
    }
    return await db.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: {
          organizationId: p.organizationId,
          userId: p.userId,
          active: true,
          role: p.role,
        },
      });
      if (!membership)
        throw new AppError(403, "Der Organisationszugang wurde geändert.");
      if (p.role === "DRIVER") {
        if (vehicleId)
          await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${p.driverId!} AND "organizationId"=${p.organizationId} FOR UPDATE`;
        if (
          !(await tx.driverProfile.count({
            where: {
              id: p.driverId!,
              organizationId: p.organizationId,
              membershipId: membership.id,
              status: "ACTIVE",
            },
          }))
        )
          throw new AppError(403, "Der Fahrerzugang ist inaktiv.");
        if (
          kind === "photo" &&
          !(await tx.vehicleAssignment.count({
            where: {
              organizationId: p.organizationId,
              driverId: p.driverId!,
              vehicleId: vehicleId!,
              endAt: null,
            },
          }))
        )
          throw new AppError(
            403,
            "Das Fahrzeug ist Ihnen nicht mehr zugewiesen.",
          );
      }
      if (replacesId) {
        await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${replacesId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
        const previous = await tx.document.findFirst({
          where: {
            id: replacesId,
            organizationId: p.organizationId,
            archivedAt: null,
          },
        });
        if (
          kind !== "document" ||
          !previous ||
          previous.driverId !== driverId ||
          previous.vehicleId !== vehicleId
        )
          throw new AppError(
            409,
            "Das zu erneuernde Dokument ist nicht mehr verfügbar.",
          );
        await tx.document.update({
          where: { id: previous.id },
          data: { archivedAt: new Date() },
        });
      }
      const stored = [];
      for (const o of objects)
        stored.push(
          await tx.storedObject.create({
            data: {
              ...o,
              organizationId: p.organizationId,
              driverId,
              vehicleId,
              createdBy: p.userId,
              status: "READY",
            },
          }),
        );
      let item: { id: string };
      if (kind === "photo") {
        item = await tx.vehiclePhotoReport.create({
          data: {
            organizationId: p.organizationId,
            vehicleId: vehicleId!,
            reporterId: p.userId,
            reporterName: p.name,
            notes,
            damage: form.get("damage") === "true",
            files: { create: stored.map((o) => ({ objectId: o.id })) },
          },
        });
      } else
        item = await tx.document.create({
          data: {
            organizationId: p.organizationId,
            title,
            vehicleId,
            driverId,
            driverVisible:
              p.role !== "DRIVER" &&
              !!vehicleId &&
              form.get("driverVisible") === "true",
            expiresAt,
            replacesId,
            objectId: stored[0].id,
          },
        });
      await audit(tx, p, "upload", kind, item.id);
      return { id: item.id };
    });
  } catch (e) {
    await Promise.allSettled(objects.map((o) => removeBytes(o.key)));
    throw e;
  }
}
/** Resolve the owning record; possession of a vehicle never implies access to all its files. */
export async function download(p: Principal, id: string) {
  const db = database();
  const o = await db.storedObject.findFirst({
    where: { id, organizationId: p.organizationId, status: "READY" },
    include: {
      documents: {
        where: { organizationId: p.organizationId, archivedAt: null },
      },
      photos: { include: { report: true } },
    },
  });
  if (!o) throw new AppError(404, "Datei nicht gefunden.");
  const reports = o.photos
    .map((photo) => photo.report)
    .filter((report) => report.organizationId === p.organizationId);
  let permitted = false;
  if (p.role === "DRIVER") {
    permitted =
      reports.some((report) => report.reporterId === p.userId) ||
      o.documents.some((doc) => doc.driverId === p.driverId);
    if (!permitted) {
      const visibleVehicles = o.documents
        .filter((doc) => doc.driverVisible && doc.vehicleId)
        .map((doc) => doc.vehicleId!);
      permitted =
        visibleVehicles.length > 0 &&
        (await db.vehicleAssignment.count({
          where: {
            organizationId: p.organizationId,
            vehicleId: { in: visibleVehicles },
            driverId: p.driverId!,
            endAt: null,
          },
        })) > 0;
    }
  } else if (p.role === "DISPATCHER")
    permitted =
      reports.length > 0 || o.documents.some((doc) => doc.driverId === null);
  else if (p.role === "ADMIN" || p.role === "SUPER_ADMIN")
    permitted = reports.length > 0 || o.documents.length > 0;
  if (!permitted) throw new AppError(404, "Datei nicht gefunden.");
  return {
    bytes: await retrieveBytes(o.key),
    mime: o.mime,
    filename: o.filename,
  };
}
