import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { mutateFleet } from "../src/features/fleet/service";
import { listModule } from "../src/server/queries";
import type { Principal } from "../src/server/policy";
let engine: PGlite, socket: PGLiteSocketServer;
const admin: Principal = {
  userId: "cat-admin",
  organizationId: "cat-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "cat-admin@example.test",
  organizationName: "Fleet",
};
const create = (name: string, type = "BRAND") =>
  mutateFleet(admin, "categories", "create", undefined, { name, type });
async function change(
  id: string,
  action: string,
  name?: string,
  version?: number,
  p = admin,
) {
  const row = await database().category.findUniqueOrThrow({ where: { id } });
  return mutateFleet(p, "categories", action, id, {
    version: version ?? row.version,
    reason: "Category maintenance",
    ...(name ? { name } : {}),
  });
}
function vehicleData(suffix: string, brand: string, brandCategoryId?: string) {
  return {
    plate: `SB-CAT ${suffix}`,
    vin: `VIN-CAT-${suffix}`,
    brand,
    brandCategoryId,
    model: "Van",
    year: 2024,
    ownership: "OWNED",
    inFleet: "2026-01-01",
    keyCount: 0,
  };
}
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5446,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5446/postgres";
  await database().organization.createMany({
    data: [
      { id: admin.organizationId, name: "Fleet" },
      { id: "cat-foreign", name: "Foreign" },
    ],
  });
  await database().user.create({
    data: { id: admin.userId, name: admin.name, email: admin.email },
  });
  await database().membership.create({
    data: {
      userId: admin.userId,
      organizationId: admin.organizationId,
      role: "ADMIN",
    },
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
});
it("renames linked brands without changing vehicle identity", async () => {
  const category = await create("Old brand");
  const vehicle = await mutateFleet(
    admin,
    "vehicles",
    "create",
    undefined,
    vehicleData("1", "Old brand", category.id),
  );
  await change(category.id, "update", "New brand");
  expect(
    await database().vehicle.findUnique({ where: { id: vehicle.id } }),
  ).toMatchObject({ brand: "New brand", brandCategoryId: category.id });
  const log = await database().auditLog.findFirstOrThrow({
    where: { resourceId: category.id, action: "category-update" },
  });
  expect(log.details).toMatchObject({
    before: { name: "Old brand" },
    after: { name: "New brand" },
    reason: "Category maintenance",
  });
});
it("archives choices while retaining current links, then restores selection", async () => {
  const category = await create("Archived brand");
  const data = vehicleData("2", "Archived brand", category.id);
  const vehicle = await mutateFleet(
    admin,
    "vehicles",
    "create",
    undefined,
    data,
  );
  await change(category.id, "archive");
  await expect(
    mutateFleet(
      admin,
      "vehicles",
      "create",
      undefined,
      vehicleData("3", "Archived brand", category.id),
    ),
  ).rejects.toThrow();
  await expect(
    mutateFleet(
      admin,
      "vehicles",
      "create",
      undefined,
      vehicleData("4", "Archived brand"),
    ),
  ).rejects.toThrow();
  await mutateFleet(admin, "vehicles", "update", vehicle.id, {
    ...data,
    model: "Updated van",
  });
  expect(
    (await database().vehicle.findUniqueOrThrow({ where: { id: vehicle.id } }))
      .brandCategoryId,
  ).toBe(category.id);
  const active = await listModule(
    admin,
    "categories",
    new URLSearchParams({ status: "ACTIVE", q: "Archived brand" }),
  );
  expect(JSON.stringify(active)).not.toContain(category.id);
  await change(category.id, "reactivate");
  await mutateFleet(
    admin,
    "vehicles",
    "create",
    undefined,
    vehicleData("5", "Archived brand", category.id),
  );
});
it("rejects foreign or wrong-type links and unauthorized changes", async () => {
  const foreign = await database().category.create({
    data: { organizationId: "cat-foreign", type: "BRAND", name: "Foreign" },
  });
  const provider = await create("Provider", "PROVIDER");
  for (const id of [foreign.id, provider.id])
    await expect(
      mutateFleet(
        admin,
        "vehicles",
        "create",
        undefined,
        vehicleData(id, "Ignored", id),
      ),
    ).rejects.toThrow();
  await expect(change(foreign.id, "archive")).rejects.toThrow();
  await expect(
    change(provider.id, "archive", undefined, undefined, {
      ...admin,
      role: "DISPATCHER",
    }),
  ).rejects.toThrow();
});
it("rejects duplicate names and stale revisions without extra audit writes", async () => {
  const category = await create("Duplicate");
  await expect(create(" duplicate ")).rejects.toThrow();
  const old = await database().category.findUniqueOrThrow({
    where: { id: category.id },
  });
  await change(category.id, "update", "Renamed");
  await expect(
    change(category.id, "archive", undefined, old.version),
  ).rejects.toThrow("neu laden");
  await expect(
    mutateFleet(admin, "categories", "update", category.id, {
      version: 2,
      name: "Changed",
      type: "PROVIDER",
      reason: "Do not change type",
    }),
  ).rejects.toThrow();
  expect(
    await database().auditLog.count({
      where: { resourceId: category.id, action: "category-update" },
    }),
  ).toBe(1);
});
it("preserves unmatched legacy text and links exact matches on category creation", async () => {
  const v = await mutateFleet(
    admin,
    "vehicles",
    "create",
    undefined,
    vehicleData("legacy", "Legacy"),
  );
  expect(
    (await database().vehicle.findUniqueOrThrow({ where: { id: v.id } }))
      .brandCategoryId,
  ).toBeNull();
  const c = await create("Legacy");
  expect(
    (await database().vehicle.findUniqueOrThrow({ where: { id: v.id } }))
      .brandCategoryId,
  ).toBe(c.id);
});
it("filters by type and reports linked use counts", async () => {
  const result = await listModule(
    admin,
    "categories",
    new URLSearchParams({ type: "PROVIDER" }),
  );
  expect(JSON.stringify(result)).not.toContain('"type":"BRAND"');
  const used = await listModule(
    admin,
    "categories",
    new URLSearchParams({ q: "New brand" }),
  );
  expect(used).toMatchObject({ items: [{ usageCount: 1 }] });
});

it("renames linked providers and clears provider links for owned vehicles", async () => {
  const category = await create("Old rental", "PROVIDER");
  const data = {
    ...vehicleData("rental", "Rental brand"),
    ownership: "RENTED",
    provider: "Old rental",
    providerCategoryId: category.id,
  };
  const v = await mutateFleet(admin, "vehicles", "create", undefined, data);
  await change(category.id, "update", "New rental");
  expect(
    await database().vehicle.findUnique({ where: { id: v.id } }),
  ).toMatchObject({ provider: "New rental", providerCategoryId: category.id });
  await mutateFleet(admin, "vehicles", "update", v.id, {
    ...data,
    ownership: "OWNED",
  });
  expect(
    await database().vehicle.findUnique({ where: { id: v.id } }),
  ).toMatchObject({ provider: null, providerCategoryId: null });
});
it("paginates categories beyond the first page and keeps type boundaries", async () => {
  for (let i = 0; i < 28; i++)
    await create(`Station ${String(i).padStart(2, "0")}`, "STATION");
  const result = await listModule(
    admin,
    "categories",
    new URLSearchParams({ type: "STATION", page: "2", pageSize: "25" }),
  );
  expect(result).toMatchObject({
    total: 28,
    items: [
      { name: "Station 25" },
      { name: "Station 26" },
      { name: "Station 27" },
    ],
  });
});
it("upgrades matching legacy vehicle text without rewriting unrelated values", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const migrationIndex = migrations.findIndex((sql) =>
      sql.includes('ALTER TABLE "Category" ADD COLUMN "status"'),
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    for (const sql of migrations.slice(0, migrationIndex))
      await legacy.exec(sql);
    await legacy.exec(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('upgrade-cat-org','Existing',NOW());
      INSERT INTO "Category" (id,"organizationId",type,name) VALUES ('upgrade-brand','upgrade-cat-org','BRAND','Exact brand');
      INSERT INTO "Vehicle" (id,"organizationId",plate,vin,brand,model,year,ownership,"inFleet","updatedAt") VALUES
      ('matched','upgrade-cat-org','SB-MATCH','VIN-MATCH','Exact brand','Van',2024,'OWNED','2026-01-01',NOW()),
      ('unmatched','upgrade-cat-org','SB-OTHER','VIN-OTHER','Other brand','Van',2024,'OWNED','2026-01-01',NOW());`);
    await legacy.exec(migrations[migrationIndex]);
    expect(
      (
        await legacy.query(
          'SELECT id,brand,"brandCategoryId" FROM "Vehicle" ORDER BY id',
        )
      ).rows,
    ).toEqual([
      { id: "matched", brand: "Exact brand", brandCategoryId: "upgrade-brand" },
      { id: "unmatched", brand: "Other brand", brandCategoryId: null },
    ]);
  } finally {
    await legacy.close();
  }
});
it("rejects mutation after the administrator loses access", async () => {
  const category = await create("Protected group", "GROUP");
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(change(category.id, "archive")).rejects.toThrow();
  expect(
    (
      await database().category.findUniqueOrThrow({
        where: { id: category.id },
      })
    ).status,
  ).toBe("ACTIVE");
});
