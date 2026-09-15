import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import {
  issueInventory,
  returnInventory,
} from "../src/features/inventory/custody";
import { inventoryMovements } from "../src/features/inventory/history";
import { mutateOperations } from "../src/features/operations/service";
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
    port: 5452,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5452/postgres";
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
  return mutateOperations(admin, "inventory", "create", undefined, {
    name: "Scanner",
    sku: randomUUID(),
    stock,
  });
}
it("shows adjustments, issues and returns with recipient and actor attribution", async () => {
  const i = await item();
  const loan = await issueInventory(admin, i.id, {
    requestId: randomUUID(),
    driverId: "board-driver",
    quantity: 3,
    reason: "Shift kit",
  });
  await returnInventory(admin, loan.id, {
    quantity: 1,
    reason: "Partial return",
    expectedVersion: 1,
  });
  const data = await inventoryMovements(
    admin,
    new URLSearchParams({ itemId: i.id }),
  );
  expect(data.total).toBe(3);
  expect(data.increase).toBe("11");
  expect(data.decrease).toBe("3");
  expect(data.net).toBe("8");
  expect(data.items.map((x) => x.type)).toEqual(
    expect.arrayContaining(["ADJUST", "ISSUE", "RETURN"]),
  );
  expect(data.items.find((x) => x.type === "ISSUE")).toMatchObject({
    recipient: "Board Driver",
    actor: "Admin",
    quantity: -3,
    reason: "Shift kit",
  });
});
it("searches item, reason, recipient and actor and applies movement types", async () => {
  const i = await item();
  await issueInventory(admin, i.id, {
    requestId: randomUUID(),
    vehicleId: "history",
    quantity: 2,
    reason: "Special purpose",
  });
  for (const q of ["Scanner", "Special purpose", "SB-history", "Admin"]) {
    const data = await inventoryMovements(
      admin,
      new URLSearchParams({ itemId: i.id, q, type: "ISSUE" }),
    );
    expect(data.total).toBe(1);
  }
  expect(
    (
      await inventoryMovements(
        admin,
        new URLSearchParams({ itemId: i.id, q: "%" }),
      )
    ).total,
  ).toBe(0);
  await expect(
    inventoryMovements(admin, new URLSearchParams({ type: "UNKNOWN" })),
  ).rejects.toThrow();
});
it("filters by half-open Berlin week boundaries", async () => {
  const i = await item(0);
  await database().inventoryMovement.createMany({
    data: [
      {
        id: "start",
        itemId: i.id,
        quantity: 1,
        reason: "Start boundary",
        actorId: admin.userId,
        createdAt: new Date("2026-09-13T22:00:00Z"),
      },
      {
        id: "end",
        itemId: i.id,
        quantity: 2,
        reason: "End boundary",
        actorId: admin.userId,
        createdAt: new Date("2026-09-20T22:00:00Z"),
      },
    ],
  });
  const data = await inventoryMovements(
    admin,
    new URLSearchParams({ itemId: i.id, week: "2026-W38" }),
  );
  expect(data.items.map((x) => x.id)).toEqual(["start"]);
  await expect(
    inventoryMovements(admin, new URLSearchParams({ week: "2026-W99" })),
  ).rejects.toThrow();
});
it("paginates all matching records with stable ties and complete filtered totals", async () => {
  const i = await item(0);
  for (let n = 0; n < 28; n++)
    await database().inventoryMovement.create({
      data: {
        itemId: i.id,
        quantity: 1,
        reason: "Paged",
        actorId: admin.userId,
        createdAt: new Date("2026-09-15T10:00:00Z"),
      },
    });
  const first = await inventoryMovements(
    admin,
    new URLSearchParams({ itemId: i.id }),
  );
  const second = await inventoryMovements(
    admin,
    new URLSearchParams({ itemId: i.id, page: "2" }),
  );
  expect(first.total).toBe(28);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(3);
  expect(first.net).toBe("28");
  expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(
    28,
  );
});
it("isolates tenant history, denies drivers and hides unscoped actor names", async () => {
  const i = await item();
  const db = database();
  await db.user.create({
    data: {
      id: "private-actor",
      name: "PRIVATE FOREIGN NAME",
      email: "private@example.test",
    },
  });
  await db.membership.create({
    data: {
      userId: "private-actor",
      organizationId: "board-foreign",
      role: "ADMIN",
    },
  });
  const foreign = await db.inventoryItem.create({
    data: {
      organizationId: "board-foreign",
      name: "FOREIGN ITEM",
      sku: "FOREIGN",
      stock: 1,
    },
  });
  await db.inventoryMovement.create({
    data: {
      itemId: foreign.id,
      quantity: 1,
      reason: "FOREIGN REASON",
      actorId: "private-actor",
    },
  });
  await db.inventoryMovement.create({
    data: {
      itemId: i.id,
      quantity: 1,
      reason: "Legacy actor",
      actorId: "private-actor",
    },
  });
  const data = await inventoryMovements(admin, new URLSearchParams());
  expect(JSON.stringify(data)).not.toContain("PRIVATE FOREIGN NAME");
  expect(JSON.stringify(data)).not.toContain("FOREIGN ITEM");
  await expect(
    inventoryMovements(admin, new URLSearchParams({ itemId: foreign.id })),
  ).rejects.toThrow();
  await expect(
    inventoryMovements(
      { ...admin, role: "DRIVER", driverId: "board-driver" },
      new URLSearchParams(),
    ),
  ).rejects.toThrow();
});
it("protects saved movements from editing and deletion", async () => {
  const i = await item();
  const movement = await database().inventoryMovement.findFirstOrThrow({
    where: { itemId: i.id },
  });
  await expect(
    engine.query('UPDATE "InventoryMovement" SET quantity=99 WHERE id=$1', [
      movement.id,
    ]),
  ).rejects.toThrow(/append-only/);
  await expect(
    engine.query('DELETE FROM "InventoryMovement" WHERE id=$1', [movement.id]),
  ).rejects.toThrow(/append-only/);
  expect(
    (
      await database().inventoryMovement.findUniqueOrThrow({
        where: { id: movement.id },
      })
    ).quantity,
  ).toBe(10);
});
