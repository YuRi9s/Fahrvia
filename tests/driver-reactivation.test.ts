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
  userId: "restore-admin",
  organizationId: "restore-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "restore@example.test",
  organizationName: "Fleet",
};
async function profile(id: string, organizationId = admin.organizationId) {
  return database().driverProfile.create({
    data: {
      id,
      organizationId,
      firstName: "Returning",
      lastName: id,
      email: `${id}@example.test`,
      status: "INACTIVE",
    },
  });
}
async function restore(id: string, p = admin, expectedUpdatedAt?: string) {
  const row = await database().driverProfile.findUniqueOrThrow({
    where: { id },
  });
  return mutateFleet(p, "drivers", "reactivate", id, {
    expectedUpdatedAt: expectedUpdatedAt ?? row.updatedAt.toISOString(),
    reason: "Returned after leave",
  });
}
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5445,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5445/postgres";
  await database().organization.createMany({
    data: [
      { id: admin.organizationId, name: "Fleet" },
      { id: "foreign-org", name: "Foreign" },
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
it("restores the same profile, preserving identity and audit history", async () => {
  const old = await profile("returning");
  const vehicle = await database().vehicle.create({
    data: {
      organizationId: admin.organizationId,
      plate: "SB-OLD 1",
      vin: "WVWZZZ1JZXW000001",
      brand: "VW",
      model: "Caddy",
      year: 2024,
      ownership: "OWNED",
      inFleet: new Date("2026-01-01"),
    },
  });
  const assignment = await database().vehicleAssignment.create({
    data: {
      organizationId: admin.organizationId,
      driverId: old.id,
      vehicleId: vehicle.id,
      startAt: new Date("2026-01-01"),
      endAt: new Date("2026-02-01"),
      createdBy: admin.userId,
      closedBy: admin.userId,
    },
  });
  await database().auditLog.create({
    data: {
      organizationId: admin.organizationId,
      actorId: admin.userId,
      action: "archive",
      resourceType: "drivers",
      resourceId: old.id,
    },
  });
  await restore(old.id);
  const row = await database().driverProfile.findUniqueOrThrow({
    where: { id: old.id },
  });
  expect(
    await database().vehicleAssignment.findUnique({
      where: { id: assignment.id },
    }),
  ).toEqual(assignment);
  expect(row).toMatchObject({
    id: old.id,
    email: old.email,
    firstName: old.firstName,
    createdAt: old.createdAt,
    status: "ACTIVE",
  });
  expect(
    await database().driverProfile.count({ where: { email: old.email } }),
  ).toBe(1);
  const logs = await database().auditLog.findMany({
    where: { resourceId: old.id },
  });
  expect(logs).toHaveLength(2);
  expect(
    logs.find((log) => log.action === "reactivate")?.details,
  ).toMatchObject({
    before: "INACTIVE",
    after: "ACTIVE",
    reason: "Returned after leave",
  });
  const listed = await listModule(
    admin,
    "drivers",
    new URLSearchParams({ status: "ACTIVE", q: old.email }),
  );
  expect(JSON.stringify(listed)).toContain(old.id);
});
it("keeps disabled account access and membership version unchanged", async () => {
  const row = await profile("disabled-login");
  await database().user.create({
    data: { id: "disabled-user", name: "Driver", email: row.email },
  });
  const membership = await database().membership.create({
    data: {
      userId: "disabled-user",
      organizationId: admin.organizationId,
      role: "DRIVER",
      active: false,
      version: 7,
    },
  });
  await database().driverProfile.update({
    where: { id: row.id },
    data: { membershipId: membership.id },
  });
  await restore(row.id);
  expect(
    await database().membership.findUnique({ where: { id: membership.id } }),
  ).toEqual(membership);
});
it("rejects drivers, dispatchers and foreign tenant records", async () => {
  await profile("protected");
  await profile("foreign", "foreign-org");
  await expect(
    restore("protected", { ...admin, role: "DISPATCHER" }),
  ).rejects.toThrow();
  await expect(
    restore("protected", { ...admin, role: "DRIVER", driverId: "protected" }),
  ).rejects.toThrow();
  await expect(restore("foreign")).rejects.toThrow();
  expect(
    await database().auditLog.count({ where: { resourceId: "protected" } }),
  ).toBe(0);
});
it("rejects stale edits and repeated reactivation without false audit records", async () => {
  const row = await profile("stale");
  await database().driverProfile.update({
    where: { id: row.id },
    data: { phone: "123", updatedAt: new Date(row.updatedAt.getTime() + 1000) },
  });
  await expect(
    restore(row.id, admin, row.updatedAt.toISOString()),
  ).rejects.toThrow("neu laden");
  await restore(row.id);
  await expect(restore(row.id)).rejects.toThrow();
  expect(
    await database().auditLog.count({
      where: { resourceId: row.id, action: "reactivate" },
    }),
  ).toBe(1);
});
it("requires a reason and expected revision", async () => {
  const row = await profile("validation");
  await expect(
    mutateFleet(admin, "drivers", "reactivate", row.id, {}),
  ).rejects.toThrow();
  expect(
    (
      await database().driverProfile.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).status,
  ).toBe("INACTIVE");
});
it("rechecks administrator access instead of trusting a stale principal", async () => {
  const row = await profile("stale-admin");
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(restore(row.id)).rejects.toThrow();
  expect(
    (
      await database().driverProfile.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).status,
  ).toBe("INACTIVE");
});
