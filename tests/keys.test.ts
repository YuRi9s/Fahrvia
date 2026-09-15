import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { mutateFleet } from "../src/features/fleet/service";
import { keyHistory } from "../src/features/keys/service";
import { listModule } from "../src/server/queries";
import type { Principal } from "../src/server/policy";
let engine: PGlite, socket: PGLiteSocketServer;
const admin: Principal = {
  userId: "key-admin",
  organizationId: "key-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "key-admin@example.test",
  organizationName: "Fleet",
};
const dispatcher: Principal = {
  ...admin,
  userId: "key-dispatch",
  role: "DISPATCHER",
};
async function vehicle(id: string, organizationId = admin.organizationId) {
  return database().vehicle.create({
    data: {
      id,
      organizationId,
      plate: `SB-${id}`,
      vin: `VIN-${id}`,
      brand: "VW",
      model: "Van",
      year: 2024,
      ownership: "OWNED",
      inFleet: new Date("2026-01-01"),
    },
  });
}
const add = (vehicleId: string, p = admin) =>
  mutateFleet(p, "keys", "create", undefined, {
    vehicleId,
    reason: "New physical key received",
  });
async function act(
  id: string,
  action: string,
  extra = {},
  p = admin,
  version?: number,
) {
  const row = await database().vehicleKey.findUniqueOrThrow({ where: { id } });
  return mutateFleet(p, "keys", action, id, {
    version: version ?? row.version,
    reason: "Key maintenance",
    ...extra,
  });
}
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5447,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5447/postgres";
  await database().organization.createMany({
    data: [
      { id: admin.organizationId, name: "Fleet" },
      { id: "key-foreign", name: "Foreign" },
    ],
  });
  for (const p of [admin, dispatcher]) {
    await database().user.create({
      data: { id: p.userId, name: p.name, email: `${p.userId}@example.test` },
    });
    await database().membership.create({
      data: {
        userId: p.userId,
        organizationId: p.organizationId,
        role: p.role,
      },
    });
  }
  await database().driverProfile.create({
    data: {
      id: "key-driver",
      organizationId: admin.organizationId,
      firstName: "Driver",
      lastName: "Test",
      email: "key-driver@example.test",
    },
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
});
it("allocates up to four active slots and records receipt", async () => {
  await vehicle("limit");
  for (let i = 1; i <= 4; i++) {
    const key = await add("limit");
    expect(
      (await database().vehicleKey.findUniqueOrThrow({ where: { id: key.id } }))
        .slot,
    ).toBe(i);
  }
  await expect(add("limit")).rejects.toThrow();
  expect(
    await database().keyCustody.count({ where: { action: "CREATE" } }),
  ).toBe(4);
});
it("replaces a key with a distinct identity while preserving its custody history", async () => {
  await vehicle("replace");
  const first = await add("replace");
  await act(first.id, "update", { location: "MISSING" });
  const oldHistory = await database().keyCustody.findMany({
    where: { keyId: first.id },
  });
  const replacement = await act(first.id, "replace");
  expect(replacement.id).not.toBe(first.id);
  expect(
    await database().vehicleKey.findUnique({ where: { id: first.id } }),
  ).toMatchObject({ status: "RETIRED", location: "MISSING" });
  expect(
    await database().vehicleKey.findUnique({ where: { id: replacement.id } }),
  ).toMatchObject({
    slot: 1,
    status: "ACTIVE",
    location: "OFFICE",
    replacesKeyId: first.id,
  });
  const history = await database().keyCustody.findMany({
    where: { keyId: first.id },
  });
  expect(history).toEqual(expect.arrayContaining(oldHistory));
  expect(history.some((row) => row.action === "RETIRE")).toBe(true);
});
it("requires a driver-held key to be returned or marked missing first", async () => {
  await vehicle("held");
  const key = await add("held");
  await act(
    key.id,
    "update",
    { location: "DRIVER", driverId: "key-driver" },
    dispatcher,
  );
  await expect(act(key.id, "retire")).rejects.toThrow();
  await expect(act(key.id, "replace")).rejects.toThrow();
  await act(key.id, "update", { location: "OFFICE" }, dispatcher);
  await act(key.id, "retire");
  expect(
    (await database().vehicleKey.findUniqueOrThrow({ where: { id: key.id } }))
      .driverId,
  ).toBeNull();
});
it("blocks retired transfers, stale changes and duplicate retirement", async () => {
  await vehicle("stale");
  const key = await add("stale");
  const version = (
    await database().vehicleKey.findUniqueOrThrow({ where: { id: key.id } })
  ).version;
  await act(key.id, "update", { location: "MISSING" });
  await expect(act(key.id, "retire", {}, admin, version)).rejects.toThrow(
    "neu laden",
  );
  await act(key.id, "retire");
  await expect(act(key.id, "update", { location: "OFFICE" })).rejects.toThrow();
  await expect(act(key.id, "retire")).rejects.toThrow();
});
it("checks tenant, live role and vehicle status", async () => {
  await vehicle("foreign", "key-foreign");
  await expect(add("foreign")).rejects.toThrow();
  await expect(add("limit", dispatcher)).rejects.toThrow();
  await vehicle("inactive");
  await database().vehicle.update({
    where: { id: "inactive" },
    data: { status: "INACTIVE" },
  });
  await expect(add("inactive")).rejects.toThrow();
  await expect(
    add("limit", { ...admin, role: "DRIVER", driverId: "key-driver" }),
  ).rejects.toThrow();
});
it("counts active keys on vehicles and filters retired keys", async () => {
  const result = await listModule(
    admin,
    "vehicles",
    new URLSearchParams({ q: "SB-replace" }),
  );
  expect(result).toMatchObject({ items: [{ keyCount: 1 }] });
  const retired = await listModule(
    admin,
    "keys",
    new URLSearchParams({ status: "RETIRED", q: "SB-replace" }),
  );
  expect(retired).toMatchObject({ total: 1, items: [{ status: "RETIRED" }] });
});
it("allows one replacement for competing submissions", async () => {
  await vehicle("race");
  const key = await add("race");
  const version = (
    await database().vehicleKey.findUniqueOrThrow({ where: { id: key.id } })
  ).version;
  const outcomes = await Promise.allSettled([
    act(key.id, "replace", {}, admin, version),
    act(key.id, "replace", {}, admin, version),
  ]);
  expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(
    await database().vehicleKey.count({
      where: { vehicleId: "race", status: "ACTIVE" },
    }),
  ).toBe(1);
});
it("paginates immutable custody history and protects it from other tenants and drivers", async () => {
  await vehicle("history");
  const key = await add("history");
  for (let i = 0; i < 27; i++)
    await act(key.id, "update", { location: i % 2 ? "OFFICE" : "MISSING" });
  const first = await keyHistory(admin, key.id);
  const second = await keyHistory(
    dispatcher,
    key.id,
    new URLSearchParams({ page: "2" }),
  );
  expect(first.total).toBe(28);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(3);
  expect(first.items[0]).toMatchObject({
    actorName: "Admin",
    reason: "Key maintenance",
  });
  await expect(
    keyHistory({ ...admin, organizationId: "key-foreign" }, key.id),
  ).rejects.toThrow();
  await expect(
    keyHistory({ ...admin, role: "DRIVER", driverId: "key-driver" }, key.id),
  ).rejects.toThrow();
  await expect(
    engine.query('UPDATE "KeyCustody" SET reason=$1 WHERE id=$2', [
      "Rewrite",
      first.items[0].id,
    ]),
  ).rejects.toThrow();
  const retired = await database().vehicleKey.findFirstOrThrow({
    where: { vehicleId: "replace", status: "RETIRED" },
  });
  const history = await keyHistory(admin, retired.id);
  expect(history.key.replacementId).toBeTruthy();
  expect(
    (await keyHistory(admin, history.key.replacementId!)).key.replacesKeyId,
  ).toBe(retired.id);
});
it("upgrades old keys and custody without inventing past events", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const migrationIndex = migrations.findIndex((sql) =>
      sql.includes('ALTER TABLE "VehicleKey" ADD COLUMN "status"'),
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    for (const sql of migrations.slice(0, migrationIndex))
      await legacy.exec(sql);
    await legacy.exec(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('key-upgrade-org','Existing',NOW());
   INSERT INTO "Vehicle" (id,"organizationId",plate,vin,brand,model,year,ownership,"inFleet","updatedAt") VALUES ('key-upgrade-vehicle','key-upgrade-org','SB-KEY','VIN-KEY','VW','Van',2024,'OWNED','2026-01-01',NOW());
   INSERT INTO "VehicleKey" (id,"organizationId","vehicleId",slot,location,"updatedAt") VALUES ('key-upgrade','key-upgrade-org','key-upgrade-vehicle',2,'MISSING',NOW());
   INSERT INTO "KeyCustody" (id,"organizationId","keyId",location,"actorId") VALUES ('old-custody','key-upgrade-org','key-upgrade','MISSING','old-actor');`);
    await legacy.exec(migrations[migrationIndex]);
    expect(
      (
        await legacy.query(
          'SELECT id,slot,location,status,version FROM "VehicleKey"',
        )
      ).rows,
    ).toEqual([
      {
        id: "key-upgrade",
        slot: 2,
        location: "MISSING",
        status: "ACTIVE",
        version: 1,
      },
    ]);
    expect(
      (await legacy.query('SELECT id,action,reason FROM "KeyCustody"')).rows,
    ).toEqual([{ id: "old-custody", action: "TRANSFER", reason: "" }]);
  } finally {
    await legacy.close();
  }
});
it("requires reasons and rejects stale administrator privileges", async () => {
  await expect(
    mutateFleet(admin, "keys", "create", undefined, { vehicleId: "held" }),
  ).rejects.toThrow();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(add("held")).rejects.toThrow();
});
