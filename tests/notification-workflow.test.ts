import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import {
  notificationAction,
  notificationDetails,
  runNotificationReminders,
} from "../src/features/notifications/service";
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
    port: 5454,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5454/postgres";
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

async function notice(extra: Record<string, unknown> = {}) {
  return database().notification.create({
    data: {
      organizationId: admin.organizationId,
      recipientId: admin.userId,
      title: "Action needed",
      body: "Check operations",
      ...extra,
    },
  });
}
it("acknowledges idempotently and completes only after acknowledgement", async () => {
  const n = await notice();
  await expect(
    notificationAction(admin, "complete", n.id, {
      expectedVersion: 1,
      outcome: "Done",
    }),
  ).rejects.toThrow();
  await notificationAction(admin, "acknowledge", n.id, { expectedVersion: 1 });
  await notificationAction(admin, "acknowledge", n.id, { expectedVersion: 1 });
  expect(
    await database().auditLog.count({
      where: { resourceId: n.id, action: "notification-acknowledge" },
    }),
  ).toBe(1);
  await notificationAction(admin, "complete", n.id, {
    expectedVersion: 2,
    outcome: "Checked and resolved",
  });
  expect((await notificationDetails(admin, n.id)).resolvedAt).not.toBeNull();
});
it("assigns staff follow-up ownership and rejects stale or unauthorized changes", async () => {
  await database().user.create({
    data: { id: "owner", name: "Owner", email: "owner@example.test" },
  });
  await database().membership.create({
    data: {
      organizationId: admin.organizationId,
      userId: "owner",
      role: "DISPATCHER",
    },
  });
  const n = await notice();
  await notificationAction(admin, "assign", n.id, {
    expectedVersion: 1,
    ownerId: "owner",
    nextAction: "Check van",
    dueAt: "2026-09-20T10:00:00Z",
  });
  await expect(
    notificationAction(admin, "assign", n.id, {
      expectedVersion: 1,
      ownerId: admin.userId,
      nextAction: "Overwrite",
    }),
  ).rejects.toThrow();
  await expect(
    notificationAction(admin, "acknowledge", n.id, { expectedVersion: 2 }),
  ).rejects.toThrow();
  const owner = { ...admin, userId: "owner", role: "DISPATCHER" as const };
  await notificationAction(owner, "acknowledge", n.id, { expectedVersion: 2 });
  expect((await notificationDetails(owner, n.id)).nextAction).toBe("Check van");
});
it("creates one durable reminder under concurrent job retries without recursive reminders", async () => {
  const n = await notice({ nextReminderAt: new Date("2026-09-01") });
  await Promise.all([runNotificationReminders(), runNotificationReminders()]);
  await runNotificationReminders();
  const reminders = await database().notification.findMany({
    where: { reminderOfId: n.id },
  });
  expect(reminders).toHaveLength(1);
  expect(reminders[0].nextReminderAt).toBeNull();
  expect((await notificationDetails(admin, n.id)).deliveryStatus).toBe(
    "CREATED",
  );
});
it("backs off unavailable recipients and recovers with an explicit retry", async () => {
  const n = await notice({ nextReminderAt: new Date("2026-09-01") });
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await runNotificationReminders();
  let row = await database().notification.findUniqueOrThrow({
    where: { id: n.id },
  });
  expect(row.deliveryStatus).toBe("RETRY");
  expect(row.deliveryAttempts).toBe(1);
  expect(row.nextReminderAt!.getTime()).toBeGreaterThan(Date.now());
  await database().notification.update({
    where: { id: n.id },
    data: { deliveryAttempts: 4, nextReminderAt: new Date("2026-09-01") },
  });
  await runNotificationReminders();
  row = await database().notification.findUniqueOrThrow({
    where: { id: n.id },
  });
  expect(row.deliveryStatus).toBe("FAILED");
  expect(row.nextReminderAt).toBeNull();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: true },
  });
  await notificationAction(admin, "retry", n.id, { expectedVersion: 1 });
  await runNotificationReminders();
  expect(
    await database().notification.count({ where: { reminderOfId: n.id } }),
  ).toBe(1);
});
it("stops generic reminders after acknowledgement but keeps due follow-up reminders", async () => {
  const n = await notice({ nextReminderAt: new Date("2026-09-01") });
  await notificationAction(admin, "acknowledge", n.id, { expectedVersion: 1 });
  await runNotificationReminders();
  expect(
    await database().notification.count({ where: { reminderOfId: n.id } }),
  ).toBe(0);
  const task = await notice();
  await notificationAction(admin, "assign", task.id, {
    expectedVersion: 1,
    ownerId: admin.userId,
    nextAction: "Inspect",
    dueAt: "2026-09-01T10:00:00Z",
  });
  await notificationAction(admin, "acknowledge", task.id, {
    expectedVersion: 2,
  });
  await runNotificationReminders();
  expect(
    await database().notification.count({ where: { reminderOfId: task.id } }),
  ).toBe(1);
});
it("requires stock recovery for stock alerts and isolates tenant and driver access", async () => {
  const item = await database().inventoryItem.create({
    data: {
      organizationId: admin.organizationId,
      name: "Item",
      sku: randomUUID(),
      stock: 0,
    },
  });
  const n = await notice({ stockItemId: item.id });
  await notificationAction(admin, "acknowledge", n.id, { expectedVersion: 1 });
  await expect(
    notificationAction(admin, "complete", n.id, {
      expectedVersion: 2,
      outcome: "Ignore",
    }),
  ).rejects.toThrow();
  await expect(
    notificationDetails({ ...admin, organizationId: "board-foreign" }, n.id),
  ).rejects.toThrow();
  const staff = await notice({ staffOnly: true });
  const driver = {
    ...admin,
    role: "DRIVER" as const,
    driverId: "board-driver",
  };
  await expect(notificationDetails(driver, staff.id)).rejects.toThrow();
  const list = await listModule(driver, "notifications", new URLSearchParams());
  expect(JSON.stringify(list)).not.toContain(staff.id);
});
it("rechecks live permissions and resolves reminder records with their parent", async () => {
  const n = await notice({ nextReminderAt: new Date("2026-09-01") });
  await runNotificationReminders();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(
    notificationAction(admin, "acknowledge", n.id, { expectedVersion: 1 }),
  ).rejects.toThrow();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: true },
  });
  await notificationAction(admin, "acknowledge", n.id, { expectedVersion: 1 });
  await notificationAction(admin, "complete", n.id, {
    expectedVersion: 2,
    outcome: "Done",
  });
  expect(
    (
      await database().notification.findFirstOrThrow({
        where: { reminderOfId: n.id },
      })
    ).resolvedAt,
  ).not.toBeNull();
});
it("includes assigned actions in search without exposing them to unrelated users", async () => {
  const n = await notice({ title: "Unique task" });
  await notificationAction(admin, "assign", n.id, {
    expectedVersion: 1,
    ownerId: "owner",
    nextAction: "Searchable follow-up",
  });
  const owner = { ...admin, userId: "owner", role: "DISPATCHER" as const };
  expect(
    await listModule(
      owner,
      "notifications",
      new URLSearchParams({ q: "Searchable follow-up" }),
    ),
  ).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ id: n.id })]),
  });
  const stranger = { ...admin, userId: "unrelated" };
  expect(
    await listModule(
      stranger,
      "notifications",
      new URLSearchParams({ q: "Unique task" }),
    ),
  ).toMatchObject({ total: 0 });
});
it("suppresses reminders that require staff access after recipient demotion", async () => {
  const member = await database().membership.findFirstOrThrow({
    where: { userId: admin.userId },
  });
  const n = await notice({
    staffOnly: true,
    nextReminderAt: new Date("2026-09-01"),
  });
  await database().driverProfile.update({
    where: { id: "board-driver" },
    data: { membershipId: member.id },
  });
  await database().membership.update({
    where: { id: member.id },
    data: { role: "DRIVER" },
  });
  await runNotificationReminders();
  expect(
    await database().notification.count({ where: { reminderOfId: n.id } }),
  ).toBe(0);
  expect(
    (await database().notification.findUniqueOrThrow({ where: { id: n.id } }))
      .deliveryStatus,
  ).toBe("RETRY");
  await database().membership.update({
    where: { id: member.id },
    data: { role: "ADMIN" },
  });
});
it("preserves legacy notification state without automatically scheduling old messages", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const index = migrations.findIndex((sql) =>
      sql.includes('ADD COLUMN "acknowledgedAt"'),
    );
    expect(index).toBeGreaterThan(0);
    for (const sql of migrations.slice(0, index)) await legacy.exec(sql);
    await legacy.exec(
      `INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('legacy','Legacy',now()); INSERT INTO "Notification" (id,"organizationId","recipientId",title,body,"readAt") VALUES ('old','legacy','user','Old','Body','2026-09-01');`,
    );
    for (const sql of migrations.slice(index)) await legacy.exec(sql);
    expect(
      (
        await legacy.query(
          `SELECT "deliveryStatus","nextReminderAt",("readAt" IS NOT NULL) AS read FROM "Notification" WHERE id='old'`,
        )
      ).rows,
    ).toEqual([{ deliveryStatus: "NONE", nextReminderAt: null, read: true }]);
    await legacy.exec(
      `INSERT INTO "Notification" (id,"organizationId","recipientId",title,body) VALUES ('new','legacy','user','New','Body');`,
    );
    expect(
      (
        await legacy.query(
          `SELECT ("nextReminderAt">CURRENT_TIMESTAMP) AS scheduled FROM "Notification" WHERE id='new'`,
        )
      ).rows,
    ).toEqual([{ scheduled: true }]);
  } finally {
    await legacy.close();
  }
});
