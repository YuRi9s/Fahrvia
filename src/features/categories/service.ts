import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse, categoryInput } from "../../server/validation";
import type { Prisma } from "../../generated/prisma/client";
type Tx = Prisma.TransactionClient;
export async function lockCategories(tx: Tx, organizationId: string) {
  // Category lifecycle and vehicle writes take this lock before any vehicle row lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId + ":categories"},0))`;
}
export async function mutateCategory(
  p: Principal,
  action: string,
  id: string | undefined,
  data: unknown,
) {
  demand(p, "categories", "write");
  if (!["ADMIN", "SUPER_ADMIN"].includes(p.role))
    throw new AppError(403, "Diese Aktion ist Administratoren vorbehalten.");
  return database().$transaction(async (tx) => {
    await lockCategories(tx, p.organizationId);
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
    const actor = await tx.membership.findFirst({
      where: {
        userId: p.userId,
        organizationId: p.organizationId,
        active: true,
      },
    });
    if (!actor || !["ADMIN", "SUPER_ADMIN"].includes(actor.role))
      throw new AppError(
        403,
        "Ein aktiver berechtigter Administrator ist erforderlich.",
      );
    const old =
      action === "create"
        ? null
        : await tx.category.findFirst({
            where: { id: id ?? "", organizationId: p.organizationId },
          });
    if (action !== "create" && !old)
      throw new AppError(404, "Kategorie nicht gefunden.");
    if (!["create", "update", "archive", "reactivate"].includes(action))
      throw new AppError(422, "Unbekannte Kategorieaktion.");
    const change =
      action === "create"
        ? null
        : parse(
            z
              .object({
                version: z.number().int().positive(),
                reason: z.string().trim().min(3).max(500),
                ...(action === "update"
                  ? { name: z.string().trim().min(1).max(100) }
                  : {}),
              })
              .strict(),
            data,
          );
    if (old && old.version !== change!.version)
      throw new AppError(
        409,
        "Die Kategorie wurde inzwischen geändert. Bitte neu laden und erneut prüfen.",
      );
    const input =
      action === "create"
        ? parse(categoryInput.strict(), data)
        : {
            type: old!.type,
            name:
              action === "update"
                ? String((change as { name?: string }).name)
                : old!.name,
          };
    if (
      ["create", "update"].includes(action) &&
      input.type === "BRAND" &&
      input.name.length > 80
    )
      throw new AppError(
        422,
        "Markennamen dürfen höchstens 80 Zeichen lang sein.",
      );
    if (
      await tx.category.findFirst({
        where: {
          organizationId: p.organizationId,
          type: input.type,
          name: { equals: input.name, mode: "insensitive" },
          ...(old ? { id: { not: old.id } } : {}),
        },
      })
    )
      throw new AppError(
        409,
        "Eine Kategorie mit diesem Namen besteht bereits, möglicherweise im Archiv.",
      );
    if (
      old &&
      ((action === "archive" && old.status !== "ACTIVE") ||
        (action === "reactivate" && old.status !== "INACTIVE") ||
        (action === "update" && input.name === old.name))
    )
      throw new AppError(
        409,
        "Keine gültige Status- oder Namensänderung ausgewählt.",
      );
    const row = old
      ? await tx.category.update({
          where: { id: old.id },
          data: {
            name: input.name,
            status:
              action === "archive"
                ? "INACTIVE"
                : action === "reactivate"
                  ? "ACTIVE"
                  : old.status,
            version: { increment: 1 },
          },
        })
      : await tx.category.create({
          data: { ...input, organizationId: p.organizationId },
        });
    if (["create", "update"].includes(action) && row.type === "BRAND")
      await tx.vehicle.updateMany({
        where: {
          organizationId: p.organizationId,
          ...(old
            ? { brandCategoryId: row.id }
            : { brandCategoryId: null, brand: row.name }),
        },
        data: { brandCategoryId: row.id, brand: row.name },
      });
    if (["create", "update"].includes(action) && row.type === "PROVIDER")
      await tx.vehicle.updateMany({
        where: {
          organizationId: p.organizationId,
          ...(old
            ? { providerCategoryId: row.id }
            : {
                providerCategoryId: null,
                provider: row.name,
                ownership: { not: "OWNED" },
              }),
        },
        data: { providerCategoryId: row.id, provider: row.name },
      });
    await tx.auditLog.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: `category-${action}`,
        resourceType: "categories",
        resourceId: row.id,
        details: {
          before: old
            ? { name: old.name, status: old.status, version: old.version }
            : null,
          after: { name: row.name, status: row.status, version: row.version },
          reason: change?.reason ?? "Kategorie erstellt",
        },
      },
    });
    return { id: row.id };
  });
}
export async function vehicleCategories(
  tx: Tx,
  organizationId: string,
  value: {
    brand: string;
    provider?: string;
    ownership: string;
    brandCategoryId?: string;
    providerCategoryId?: string;
  },
  old?: {
    brand: string;
    provider: string | null;
    brandCategoryId: string | null;
    providerCategoryId: string | null;
  },
) {
  async function resolve(
    type: "BRAND" | "PROVIDER",
    name: string | undefined,
    id: string | undefined,
    oldId: string | null | undefined,
    oldName: string | null | undefined,
  ) {
    if (!name && !id) return { name: null, id: null };
    const keepId = id || (oldName === name ? oldId : null);
    const category = await tx.category.findFirst({
      where: {
        organizationId,
        type,
        ...(keepId
          ? { id: keepId }
          : { name: { equals: name!, mode: "insensitive" } }),
      },
    });
    if (keepId && !category)
      throw new AppError(
        422,
        "Die Kategorie gehört nicht zu diesem Typ oder dieser Organisation.",
      );
    if (!category) return { name: name!, id: null };
    if (category.status !== "ACTIVE" && category.id !== oldId)
      throw new AppError(
        409,
        "Archivierte Kategorien können nicht neu zugeordnet werden.",
      );
    return { name: category.name, id: category.id };
  }
  const brand = await resolve(
    "BRAND",
    value.brand,
    value.brandCategoryId,
    old?.brandCategoryId,
    old?.brand,
  );
  const provider =
    value.ownership === "OWNED"
      ? { name: null, id: null }
      : await resolve(
          "PROVIDER",
          value.provider,
          value.providerCategoryId,
          old?.providerCategoryId,
          old?.provider,
        );
  return {
    brand: brand.name!,
    brandCategoryId: brand.id,
    provider: provider.name,
    providerCategoryId: provider.id,
  };
}
