import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import {
  issueInventory,
  returnInventory,
} from "../src/features/inventory/custody";
import {
  configureStockAlert,
  reconcileStockAlerts,
} from "../src/features/inventory/alerts";
import { mutateOperations } from "../src/features/operations/service";
import { listModule } from "../src/server/queries";
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
    port: 5453,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5453/postgres";
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

async function item(stock = 5, minimumStock = 3) {
  return mutateOperations(admin, "inventory", "create", undefined, {
    name: "Scanner",
    sku: randomUUID(),
    stock,
    minimumStock,
  });
}
const setup = (
  id: string,
  expectedVersion = 1,
  recipientId: string | null = admin.userId,
  minimumStock = 3,
) =>
  configureStockAlert(admin, id, {
    expectedVersion,
    recipientId,
    minimumStock,
  });
const alerts = (id: string) =>
  database().notification.findMany({
    where: { stockItemId: id },
    orderBy: { createdAt: "asc" },
  });
it("creates one alert per low-stock episode and resolves on recovery", async () => {
  const i = await item();
  await setup(i.id);
  await mutateOperations(admin, "inventory", "adjust", i.id, {
    quantity: -3,
    reason: "Use",
  });
  expect(await alerts(i.id)).toHaveLength(1);
  await reconcileStockAlerts();
  await reconcileStockAlerts();
  await mutateOperations(admin, "inventory", "adjust", i.id, {
    quantity: -1,
    reason: "Use",
  });
  expect(await alerts(i.id)).toHaveLength(1);
  await mutateOperations(admin, "inventory", "adjust", i.id, {
    quantity: 2,
    reason: "Restock",
  });
  expect((await alerts(i.id))[0].resolvedAt).not.toBeNull();
  await mutateOperations(admin, "inventory", "adjust", i.id, {
    quantity: -1,
    reason: "New shortage",
  });
  expect(await alerts(i.id)).toHaveLength(2);
});
it("alerts immediately when configured below minimum but not at equality", async () => {
  const low = await item(1);
  await setup(low.id);
  expect(await alerts(low.id)).toHaveLength(1);
  const equal = await item(3);
  await setup(equal.id);
  expect(await alerts(equal.id)).toHaveLength(0);
  await setup(equal.id, 2, admin.userId, 4);
  expect(await alerts(equal.id)).toHaveLength(1);
});
it("evaluates inventory issues and partial/full returns atomically", async () => {
  const i = await item();
  await setup(i.id);
  const loan = await issueInventory(admin, i.id, {
    requestId: randomUUID(),
    driverId: "board-driver",
    quantity: 3,
    reason: "Kit",
  });
  expect(await alerts(i.id)).toHaveLength(1);
  await returnInventory(admin, loan.id, {
    quantity: 1,
    reason: "Returned",
    expectedVersion: 1,
  });
  expect((await alerts(i.id))[0].resolvedAt).not.toBeNull();
});
it("deduplicates concurrent checks and keeps read alerts read", async () => {
  const i = await item(1);
  await setup(i.id);
  const first = (await alerts(i.id))[0];
  await mutateOperations(admin, "notifications", "read", first.id, {});
  await Promise.all([reconcileStockAlerts(), reconcileStockAlerts()]);
  expect(await alerts(i.id)).toHaveLength(1);
  expect((await alerts(i.id))[0].readAt).not.toBeNull();
});
it("rejects stale settings and foreign or driver recipients", async () => {
  const i = await item();
  await setup(i.id);
  await expect(setup(i.id, 1)).rejects.toThrow();
  await database().user.create({
    data: {
      id: "recipient-driver",
      name: "Recipient driver",
      email: "rdriver@example.test",
    },
  });
  await database().membership.create({
    data: {
      userId: "recipient-driver",
      organizationId: admin.organizationId,
      role: "DRIVER",
    },
  });
  await expect(setup(i.id, 2, "recipient-driver")).rejects.toThrow();
  await expect(
    configureStockAlert({ ...admin, organizationId: "board-foreign" }, i.id, {
      expectedVersion: 2,
      recipientId: admin.userId,
      minimumStock: 3,
    }),
  ).rejects.toThrow();
  await expect(setup(i.id, 2, "foreign-user")).rejects.toThrow();
});
it("suppresses unavailable recipients, resumes after reactivation and includes self in the staff picker", async () => {
  const i = await item();
  await setup(i.id);
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(setup(i.id, 2)).rejects.toThrow();
  await database().inventoryItem.update({
    where: { id: i.id },
    data: { stock: 1 },
  });
  await reconcileStockAlerts();
  expect(await alerts(i.id)).toHaveLength(0);
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: true },
  });
  await reconcileStockAlerts();
  expect(await alerts(i.id)).toHaveLength(1);
  const picker = await listModule(
    admin,
    "recipients",
    new URLSearchParams({ purpose: "stock-alert" }),
  );
  expect(picker).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({ id: admin.userId }),
    ]),
  });
  expect(JSON.stringify(picker)).not.toContain("recipient-driver");
});
it("disabling alerts and a zero minimum suppress new notifications", async () => {
  const i = await item(1);
  await setup(i.id, 1, null);
  await reconcileStockAlerts();
  expect(await alerts(i.id)).toHaveLength(0);
  await setup(i.id, 2, admin.userId, 0);
  await reconcileStockAlerts();
  expect(await alerts(i.id)).toHaveLength(0);
});
it("does not expose stock alerts to a demoted driver", async () => {
  const i = await item(1);
  await setup(i.id);
  const driver = {
    ...admin,
    role: "DRIVER" as const,
    driverId: "board-driver",
  };
  const visible = await listModule(
    driver,
    "notifications",
    new URLSearchParams(),
  );
  expect(JSON.stringify(visible)).not.toContain("Mindestbestand");
  await expect(
    listModule(
      driver,
      "recipients",
      new URLSearchParams({ purpose: "stock-alert" }),
    ),
  ).rejects.toThrow();
});
it("notifies each responsible staff member at most once in the same episode", async () => {
  const i = await item(1);
  await setup(i.id);
  await database().user.create({
    data: { id: "backup-staff", name: "Backup", email: "backup@example.test" },
  });
  await database().membership.create({
    data: {
      userId: "backup-staff",
      organizationId: admin.organizationId,
      role: "DISPATCHER",
    },
  });
  await setup(i.id, 2, "backup-staff");
  await setup(i.id, 3, admin.userId);
  expect((await alerts(i.id)).map((x) => x.recipientId).sort()).toEqual(
    [admin.userId, "backup-staff"].sort(),
  );
});
it("evaluates edits to the existing minimum field and rejects stale threshold edits", async () => {
  const i = await item();
  await setup(i.id);
  const old = await database().inventoryItem.findUniqueOrThrow({
    where: { id: i.id },
  });
  await mutateOperations(admin, "inventory", "update", i.id, {
    name: old.name,
    sku: old.sku,
    stock: old.stock,
    minimumStock: 6,
    expectedAlertVersion: old.alertVersion,
  });
  expect(await alerts(i.id)).toHaveLength(1);
  await expect(setup(i.id, old.alertVersion)).rejects.toThrow();
  await expect(
    mutateOperations(admin, "inventory", "update", i.id, {
      name: old.name,
      sku: old.sku,
      stock: old.stock,
      minimumStock: 3,
      expectedAlertVersion: old.alertVersion,
    }),
  ).rejects.toThrow();
});
