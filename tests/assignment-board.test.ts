import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import {
  assignmentBoard,
  assignmentDetails,
} from "../src/features/assignments/board";
import { mutateFleet, assignVehicle } from "../src/features/fleet/service";
import { listModule } from "../src/server/queries";
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
const week = "2026-W37";
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
    port: 5448,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5448/postgres";
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
it("uses half-open Berlin day boundaries and carries assignments across days", async () => {
  await entry(
    "before-week",
    "history",
    "2026-09-06T10:00:00Z",
    "2026-09-06T22:00:00Z",
  );
  await entry(
    "cross-day",
    "history",
    "2026-09-07T21:00:00Z",
    "2026-09-08T01:00:00Z",
  );
  const board = await assignmentBoard(admin, params({ q: "SB-history" }));
  expect(board.days[0].date).toBe("2026-09-07");
  expect(board.items[0].days.map((day) => day.count)).toEqual([
    1, 1, 0, 0, 0, 0, 0,
  ]);
  const detail = await assignmentDetails(
    admin,
    params({ vehicleId: "history", date: "2026-09-07" }),
  );
  expect(detail.items.map((row) => row.id)).toEqual(["cross-day"]);
});
it("counts every assignment while paging detail records independently", async () => {
  await vehicle("busy-history");
  for (let i = 0; i < 28; i++)
    await entry(
      `past-${i}`,
      "busy-history",
      `2026-09-09T${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00Z`,
      `2026-09-09T${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "45" : "15"}:00Z`,
    );
  const board = await assignmentBoard(admin, params({ q: "SB-busy-history" }));
  expect(board.items[0].days[2].count).toBe(28);
  const first = await assignmentDetails(
    admin,
    params({ vehicleId: "busy-history", date: "2026-09-09" }),
  );
  const second = await assignmentDetails(
    admin,
    params({ vehicleId: "busy-history", date: "2026-09-09", page: "2" }),
  );
  expect(first.total).toBe(28);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(3);
});
it("paginates vehicles and isolates tenants and staff access", async () => {
  for (let i = 0; i < 27; i++)
    await vehicle(`page-${String(i).padStart(2, "0")}`);
  const result = await assignmentBoard(
    admin,
    params({ q: "SB-page", page: "2" }),
  );
  expect(result.total).toBe(27);
  expect(result.items).toHaveLength(2);
  expect(JSON.stringify(await assignmentBoard(admin, params()))).not.toContain(
    "SB-foreign",
  );
  await expect(
    assignmentBoard(
      { ...admin, role: "DRIVER", driverId: "board-driver" },
      params(),
    ),
  ).rejects.toThrow();
  await expect(
    assignmentDetails(admin, params({ vehicleId: "foreign" })),
  ).rejects.toThrow();
});
it("shows current availability separately from historical occupancy", async () => {
  const result = await assignmentBoard(
    admin,
    params({ q: "SB-history", availability: "AVAILABLE" }),
  );
  expect(result.items[0].availableNow).toBe(true);
  const current = await assignVehicle(admin, {
    vehicleId: "history",
    driverId: "board-driver",
  });
  const assigned = await assignmentBoard(
    admin,
    params({ q: "SB-history", availability: "ASSIGNED" }),
  );
  expect(assigned.items[0]).toMatchObject({
    availableNow: false,
    currentDriverName: "Board Driver",
  });
  const availableDrivers = await listModule(
    admin,
    "drivers",
    new URLSearchParams({ availableForAssignment: "1" }),
  );
  expect(availableDrivers).toMatchObject({ total: 0 });
  await mutateFleet(admin, "assignments", "close", current.id, {});
  expect(
    (
      await assignmentBoard(
        admin,
        params({ q: "SB-history", availability: "AVAILABLE" }),
      )
    ).items,
  ).toHaveLength(1);
});
it("handles DST weeks and validates dates belong to the selected week", async () => {
  const spring = await assignmentBoard(admin, params({ week: "2026-W13" }));
  expect(
    new Date(spring.days[6].end).getTime() -
      new Date(spring.days[6].start).getTime(),
  ).toBe(23 * 3600000);
  const fall = await assignmentBoard(admin, params({ week: "2026-W43" }));
  expect(
    new Date(fall.days[6].end).getTime() -
      new Date(fall.days[6].start).getTime(),
  ).toBe(25 * 3600000);
  await expect(
    assignmentBoard(admin, params({ week: "2026-W99" })),
  ).rejects.toThrow();
  await expect(
    assignmentDetails(
      admin,
      params({ vehicleId: "history", date: "2026-10-01" }),
    ),
  ).rejects.toThrow();
});
it("closes an assignment once under competing requests without duplicate audit", async () => {
  const current = await assignVehicle(admin, {
    vehicleId: "history",
    driverId: "board-driver",
  });
  const result = await Promise.allSettled([
    mutateFleet(admin, "assignments", "close", current.id, {}),
    mutateFleet(admin, "assignments", "close", current.id, {}),
  ]);
  expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(
    await database().auditLog.count({
      where: { resourceId: current.id, action: "close" },
    }),
  ).toBe(1);
});
it("rechecks assignment write permissions after the administrator loses access", async () => {
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(
    assignVehicle(admin, { vehicleId: "history", driverId: "board-driver" }),
  ).rejects.toThrow();
});
