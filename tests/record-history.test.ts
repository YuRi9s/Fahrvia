import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { recordHistory } from "../src/features/fleet/history";
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
const week = "";
const params = (extra: Record<string, string> = {}) =>
  new URLSearchParams({ week, ...extra });
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
async function entry(
  id: string,
  vehicleId: string,
  startAt: string,
  endAt: string | null,
) {
  return database().vehicleAssignment.create({
    data: {
      id,
      organizationId: admin.organizationId,
      vehicleId,
      driverId: "board-driver",
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      createdBy: admin.userId,
    },
  });
}
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5449,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5449/postgres";
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

it("shows a scoped vehicle summary and both assignment events", async () => {
  await entry(
    "closed",
    "history",
    "2026-09-07T10:00:00Z",
    "2026-09-08T10:00:00Z",
  );
  const data = await recordHistory(admin, "vehicles", "history", params());
  expect(data.record.title).toBe("SB-history");
  expect(data.items.map((x) => x.action)).toEqual(["RETURN", "ASSIGN"]);
  expect(data.items[0].detail).toContain("Board Driver");
});
it("isolates tenants and prevents drivers viewing vehicle or other-driver history", async () => {
  await expect(
    recordHistory(admin, "vehicles", "foreign", params()),
  ).rejects.toThrow();
  const driver: Principal = {
    ...admin,
    role: "DRIVER",
    driverId: "board-driver",
  };
  await expect(
    recordHistory(driver, "vehicles", "history", params()),
  ).rejects.toThrow();
  await expect(
    recordHistory(driver, "drivers", "someone-else", params()),
  ).rejects.toThrow();
  const own = await recordHistory(driver, "drivers", "board-driver", params());
  expect(own.items).toHaveLength(2);
  expect(own.items[0].detail).toBe("SB-history");
});
it("filters events by Berlin week with an exclusive end boundary", async () => {
  await entry(
    "boundary",
    "history",
    "2026-09-06T22:00:00Z",
    "2026-09-13T22:00:00Z",
  );
  const data = await recordHistory(
    admin,
    "vehicles",
    "history",
    params({ week: "2026-W37" }),
  );
  expect(data.items.some((x) => x.id === "assign:boundary")).toBe(true);
  expect(data.items.some((x) => x.id === "return:boundary")).toBe(false);
  await expect(
    recordHistory(admin, "vehicles", "history", params({ week: "2026-W99" })),
  ).rejects.toThrow();
});
it("paginates the merged event stream with stable ordering and exact totals", async () => {
  await vehicle("pages");
  for (let i = 0; i < 16; i++)
    await entry(
      `page-${i}`,
      "pages",
      "2026-09-01T10:00:00Z",
      "2026-09-01T11:00:00Z",
    );
  const first = await recordHistory(admin, "vehicles", "pages", params());
  const second = await recordHistory(
    admin,
    "vehicles",
    "pages",
    params({ page: "2" }),
  );
  expect(first.total).toBe(32);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(7);
  expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(
    32,
  );
});
it("includes photo, key and lifecycle events without exposing audit details", async () => {
  const db = database();
  await db.vehiclePhotoReport.create({
    data: {
      id: "photo",
      organizationId: admin.organizationId,
      vehicleId: "history",
      reporterId: admin.userId,
      reporterName: "Admin",
      damage: true,
      notes: "Scratch",
    },
  });
  await db.vehicleKey.create({
    data: {
      id: "key",
      organizationId: admin.organizationId,
      vehicleId: "history",
      slot: 1,
    },
  });
  await db.keyCustody.create({
    data: {
      organizationId: admin.organizationId,
      keyId: "key",
      actorId: admin.userId,
      location: "OFFICE",
      reason: "Received",
    },
  });
  await db.auditLog.create({
    data: {
      organizationId: admin.organizationId,
      actorId: admin.userId,
      action: "archive",
      resourceType: "vehicles",
      resourceId: "history",
      details: { secret: "DO-NOT-EXPOSE" },
    },
  });
  const data = await recordHistory(admin, "vehicles", "history", params());
  expect(data.items.map((x) => x.type)).toEqual(
    expect.arrayContaining(["PHOTO", "KEY", "LIFECYCLE"]),
  );
  expect(JSON.stringify(data)).not.toContain("DO-NOT-EXPOSE");
  const filtered = await recordHistory(
    admin,
    "vehicles",
    "history",
    params({ type: "PHOTO" }),
  );
  expect(filtered.total).toBe(1);
});
it("limits driver histories to assignments and validates event filters", async () => {
  const driver: Principal = {
    ...admin,
    role: "DRIVER",
    driverId: "board-driver",
  };
  await expect(
    recordHistory(
      driver,
      "drivers",
      "board-driver",
      params({ type: "DOCUMENT" }),
    ),
  ).rejects.toThrow();
  await expect(
    recordHistory(admin, "vehicles", "history", params({ type: "BAD" })),
  ).rejects.toThrow();
  await expect(
    recordHistory(admin, "unknown", "history", params()),
  ).rejects.toThrow();
});
it("retains archived record history and document renewal provenance without file secrets", async () => {
  const db = database();
  await db.storedObject.create({
    data: {
      id: "object",
      organizationId: admin.organizationId,
      key: "PRIVATE-STORAGE-KEY",
      filename: "test.pdf",
      mime: "application/pdf",
      size: 1,
      createdBy: admin.userId,
    },
  });
  await db.document.create({
    data: {
      id: "doc",
      organizationId: admin.organizationId,
      driverId: "board-driver",
      title: "Licence",
      objectId: "object",
    },
  });
  await db.document.create({
    data: {
      id: "renewal",
      organizationId: admin.organizationId,
      driverId: "board-driver",
      title: "Renewed licence",
      objectId: "object",
      replacesId: "doc",
    },
  });
  await db.driverProfile.update({
    where: { id: "board-driver" },
    data: { status: "INACTIVE" },
  });
  const data = await recordHistory(
    admin,
    "drivers",
    "board-driver",
    params({ type: "DOCUMENT" }),
  );
  expect(data.record.fields.status).toBe("INACTIVE");
  expect(data.total).toBe(2);
  expect(data.items.map((x) => x.action)).toContain("DOCUMENT_RENEWED");
  expect(JSON.stringify(data)).not.toContain("PRIVATE-STORAGE-KEY");
  const own = await recordHistory(
    { ...admin, role: "DRIVER", driverId: "board-driver" },
    "drivers",
    "board-driver",
    params(),
  );
  expect(own.items.every((x) => x.type === "ASSIGNMENT")).toBe(true);
});
