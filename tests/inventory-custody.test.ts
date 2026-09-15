import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import {
  issueInventory,
  returnInventory,
  inventoryCustody,
} from "../src/features/inventory/custody";
import { randomUUID } from "node:crypto";
import type { Principal } from "../src/server/policy";
let engine: PGlite, socket: PGLiteSocketServer;
const admin: Principal = {
  userId: "board-admin",
  organizationId: "board-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "board@example.test",
  organizationName: "Fleet",
};
async function vehicle(id: string, org = admin.organizationId) {
  return database().vehicle.create({
    data: {
      id,
      organizationId: org,
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
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5451,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5451/postgres";
  await database().organization.createMany({
    data: [
      { id: admin.organizationId, name: "Fleet" },
      { id: "board-foreign", name: "Foreign" },
    ],
  });
  await database().user.create({
    data: { id: admin.userId, name: admin.name, email: admin.email },
  });
  await database().membership.create({
    data: {
      userId: admin.userId,
      organizationId: admin.organizationId,
      role: admin.role,
    },
  });
  await database().driverProfile.create({
    data: {
      id: "board-driver",
      organizationId: admin.organizationId,
      firstName: "Board",
      lastName: "Driver",
      email: "driver@example.test",
    },
  });
  await vehicle("history");
  await vehicle("foreign", "board-foreign");
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
});

async function item(stock = 10) {
  return database().inventoryItem.create({
    data: {
      organizationId: admin.organizationId,
      name: "Scanner",
      sku: randomUUID(),
      stock,
    },
  });
}
const issue = (itemId: string, extra: Record<string, unknown> = {}) =>
  issueInventory(admin, itemId, {
    requestId: randomUUID(),
    driverId: "board-driver",
    quantity: 3,
    reason: "Shift equipment",
    ...extra,
  });
it("issues quantities to a driver and restores stock through partial and full returns", async () => {
  const i = await item();
  const loan = await issue(i.id);
  expect(
    (await database().inventoryItem.findUniqueOrThrow({ where: { id: i.id } }))
      .stock,
  ).toBe(7);
  const data = await inventoryCustody(
    admin,
    new URLSearchParams({ itemId: i.id }),
  );
  expect(data.issued).toBe(3);
  expect(data.items[0].holder).toBe("Board Driver");
  await returnInventory(admin, loan.id, {
    quantity: 1,
    reason: "Partial return",
    expectedVersion: 1,
  });
  const partial = await inventoryCustody(
    admin,
    new URLSearchParams({ itemId: i.id }),
  );
  expect(partial.items[0]).toMatchObject({ remaining: 2, version: 2 });
  expect(partial.item.stock).toBe(8);
  await returnInventory(admin, loan.id, {
    quantity: 2,
    reason: "All returned",
    expectedVersion: 2,
  });
  expect(
    (await inventoryCustody(admin, new URLSearchParams({ itemId: i.id })))
      .issued,
  ).toBe(0);
  expect(
    (
      await database().inventoryMovement.findMany({
        where: { itemId: i.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((x) => x.quantity),
  ).toEqual([-3, 1, 2]);
});
it("supports vehicle custody and rejects invalid or foreign recipients", async () => {
  const i = await item();
  const loan = await issue(i.id, { driverId: undefined, vehicleId: "history" });
  expect(loan.id).toBeTruthy();
  await expect(issue(i.id, { vehicleId: "history" })).rejects.toThrow();
  await expect(
    issue(i.id, { driverId: undefined, vehicleId: undefined }),
  ).rejects.toThrow();
  await expect(
    issue(i.id, { driverId: undefined, vehicleId: "foreign" }),
  ).rejects.toThrow();
  await database().driverProfile.update({
    where: { id: "board-driver" },
    data: { status: "INACTIVE" },
  });
  await expect(issue(i.id)).rejects.toThrow();
  await database().driverProfile.update({
    where: { id: "board-driver" },
    data: { status: "ACTIVE" },
  });
});
it("serializes competing issues without negative stock", async () => {
  const i = await item(3);
  const result = await Promise.allSettled([issue(i.id), issue(i.id)]);
  expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(
    (await database().inventoryItem.findUniqueOrThrow({ where: { id: i.id } }))
      .stock,
  ).toBe(0);
});
it("replays the same issue request once and rejects changed replay payloads", async () => {
  const i = await item();
  const requestId = randomUUID();
  const results = await Promise.all([
    issue(i.id, { requestId }),
    issue(i.id, { requestId }),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(
    await database().inventoryCustody.count({ where: { itemId: i.id } }),
  ).toBe(1);
  expect(
    await database().inventoryMovement.count({ where: { itemId: i.id } }),
  ).toBe(1);
  await expect(issue(i.id, { requestId, quantity: 2 })).rejects.toThrow();
});
it("rejects excess and stale returns, preserving a single return movement", async () => {
  const i = await item();
  const loan = await issue(i.id);
  await expect(
    returnInventory(admin, loan.id, {
      quantity: 4,
      expectedVersion: 1,
      reason: "Return",
    }),
  ).rejects.toThrow();
  const result = await Promise.allSettled([
    returnInventory(admin, loan.id, {
      quantity: 3,
      expectedVersion: 1,
      reason: "Return",
    }),
    returnInventory(admin, loan.id, {
      quantity: 3,
      expectedVersion: 1,
      reason: "Return",
    }),
  ]);
  expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(
    await database().inventoryMovement.count({ where: { itemId: i.id } }),
  ).toBe(2);
  expect(
    (await database().inventoryItem.findUniqueOrThrow({ where: { id: i.id } }))
      .stock,
  ).toBe(10);
});
it("pages custody records and keeps totals independent of filters", async () => {
  const i = await item(40);
  for (let n = 0; n < 27; n++) await issue(i.id, { quantity: 1 });
  const data = await inventoryCustody(
    admin,
    new URLSearchParams({ itemId: i.id, page: "2" }),
  );
  expect(data.total).toBe(27);
  expect(data.items).toHaveLength(2);
  expect(data.issued).toBe(27);
  const closed = await inventoryCustody(
    admin,
    new URLSearchParams({ itemId: i.id, status: "CLOSED" }),
  );
  expect(closed.total).toBe(0);
  expect(closed.issued).toBe(27);
});
it("enforces tenant access, driver denial and live staff permission", async () => {
  const i = await item();
  const loan = await issue(i.id);
  const foreign = { ...admin, organizationId: "board-foreign" };
  const driver = {
    ...admin,
    role: "DRIVER" as const,
    driverId: "board-driver",
  };
  await expect(
    inventoryCustody(foreign, new URLSearchParams({ itemId: i.id })),
  ).rejects.toThrow();
  await expect(
    returnInventory(foreign, loan.id, {
      quantity: 1,
      reason: "Return",
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  await expect(
    inventoryCustody(driver, new URLSearchParams({ itemId: i.id })),
  ).rejects.toThrow();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(issue(i.id)).rejects.toThrow();
  await expect(
    returnInventory(admin, loan.id, {
      quantity: 1,
      reason: "Return",
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: true },
  });
});
it("accepts returns from archived recipients and rejects nonpositive quantities", async () => {
  const i = await item();
  const loan = await issue(i.id);
  await database().driverProfile.update({
    where: { id: "board-driver" },
    data: { status: "INACTIVE" },
  });
  await returnInventory(admin, loan.id, {
    quantity: 3,
    reason: "Offboarding return",
    expectedVersion: 1,
  });
  await database().driverProfile.update({
    where: { id: "board-driver" },
    data: { status: "ACTIVE" },
  });
  await expect(issue(i.id, { quantity: 0 })).rejects.toThrow();
  await expect(issue(i.id, { quantity: 1.5 })).rejects.toThrow();
  await expect(issue(i.id, { reason: "" })).rejects.toThrow();
});
it("preserves existing stock and adjustments when applying the custody migration", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const index = migrations.findIndex((sql) =>
      sql.includes('CREATE TABLE "InventoryCustody"'),
    );
    expect(index).toBeGreaterThan(0);
    for (const sql of migrations.slice(0, index)) await legacy.exec(sql);
    await legacy.exec(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('old-org','Old org',now());
       INSERT INTO "InventoryItem" (id,"organizationId",name,sku,stock,"updatedAt") VALUES ('old-item','old-org','Scanner','OLD',7,now());
      INSERT INTO "InventoryMovement" (id,"itemId",quantity,reason,"actorId") VALUES ('old-movement','old-item',7,'Opening stock','old-user');`);
    for (const sql of migrations.slice(index)) await legacy.exec(sql);
    expect(
      (
        await legacy.query(
          `SELECT stock FROM "InventoryItem" WHERE id='old-item'`,
        )
      ).rows,
    ).toEqual([{ stock: 7 }]);
    expect(
      (
        await legacy.query(
          `SELECT quantity,reason,type,"custodyId" FROM "InventoryMovement" WHERE id='old-movement'`,
        )
      ).rows,
    ).toEqual([
      { quantity: 7, reason: "Opening stock", type: "ADJUST", custodyId: null },
    ]);
    expect(
      (
        await legacy.query(
          `SELECT COUNT(*)::int AS count FROM "InventoryCustody"`,
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await legacy.close();
  }
});
