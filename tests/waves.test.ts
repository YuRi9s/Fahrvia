import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { mutateFleet } from "../src/features/fleet/service";
import { mutateWave } from "../src/features/waves/service";
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
    port: 5450,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5450/postgres";
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

const draft = (
  participants: { driverId: string; vehicleId: string }[] = [],
) => ({
  name: "Morning",
  startAt: "2026-09-15T07:00:00Z",
  packages: 10,
  delivered: 0,
  participants,
});
const pair = { driverId: "board-driver", vehicleId: "history" };
it("creates multi-participant waves and lists their paired names", async () => {
  await vehicle("second");
  await database().driverProfile.create({
    data: {
      id: "second-driver",
      organizationId: admin.organizationId,
      firstName: "Second",
      lastName: "Driver",
      email: "second@example.test",
    },
  });
  const wave = await mutateWave(
    admin,
    "create",
    undefined,
    draft([pair, { driverId: "second-driver", vehicleId: "second" }]),
  );
  const list = await listModule(
    admin,
    "waves",
    new URLSearchParams({ q: "Morning" }),
  );
  expect(list).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({ id: wave.id, participantCount: 2, version: 1 }),
    ]),
  });
});
it("rejects duplicate, cross-tenant and inactive participants", async () => {
  await expect(
    mutateWave(admin, "create", undefined, draft([pair, pair])),
  ).rejects.toThrow();
  await expect(
    mutateWave(
      admin,
      "create",
      undefined,
      draft([{ ...pair, vehicleId: "foreign" }]),
    ),
  ).rejects.toThrow();
  await vehicle("inactive");
  await database().vehicle.update({
    where: { id: "inactive" },
    data: { status: "INACTIVE" },
  });
  await expect(
    mutateWave(
      admin,
      "create",
      undefined,
      draft([{ ...pair, vehicleId: "inactive" }]),
    ),
  ).rejects.toThrow();
});
it("requires participants to start and follows planned-active-completed transitions", async () => {
  const empty = await mutateWave(admin, "create", undefined, draft());
  await expect(
    mutateWave(admin, "transition", empty.id, {
      status: "ACTIVE",
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  const wave = await mutateWave(admin, "create", undefined, draft([pair]));
  await expect(
    mutateWave(admin, "transition", wave.id, {
      status: "COMPLETED",
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  await mutateWave(admin, "transition", wave.id, {
    status: "ACTIVE",
    expectedVersion: 1,
  });
  await expect(
    mutateWave(admin, "transition", wave.id, {
      status: "COMPLETED",
      expectedVersion: 2,
    }),
  ).rejects.toThrow();
  await mutateWave(admin, "progress", wave.id, {
    delivered: 10,
    expectedVersion: 2,
  });
  await mutateWave(admin, "transition", wave.id, {
    status: "COMPLETED",
    expectedVersion: 3,
  });
  await expect(
    mutateWave(admin, "progress", wave.id, {
      delivered: 9,
      expectedVersion: 4,
    }),
  ).rejects.toThrow();
});
it("rejects stale edits and competing activation of the same resources", async () => {
  const a = await mutateWave(admin, "create", undefined, draft([pair]));
  const b = await mutateWave(admin, "create", undefined, draft([pair]));
  const results = await Promise.allSettled([
    mutateWave(admin, "transition", a.id, {
      status: "ACTIVE",
      expectedVersion: 1,
    }),
    mutateWave(admin, "transition", b.id, {
      status: "ACTIVE",
      expectedVersion: 1,
    }),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const winner = results[0].status === "fulfilled" ? a : b;
  await expect(
    mutateWave(admin, "progress", winner.id, {
      delivered: 1,
      expectedVersion: 1,
    }),
  ).rejects.toThrow();
  await mutateWave(admin, "progress", winner.id, {
    delivered: 10,
    expectedVersion: 2,
  });
  await mutateWave(admin, "transition", winner.id, {
    status: "COMPLETED",
    expectedVersion: 3,
  });
});
it("freezes active wave composition and rejects invalid progress", async () => {
  const wave = await mutateWave(admin, "create", undefined, draft([pair]));
  await mutateWave(admin, "transition", wave.id, {
    status: "ACTIVE",
    expectedVersion: 1,
  });
  await expect(
    mutateWave(admin, "update", wave.id, { ...draft(), expectedVersion: 2 }),
  ).rejects.toThrow();
  await expect(
    mutateWave(admin, "progress", wave.id, {
      delivered: 11,
      expectedVersion: 2,
    }),
  ).rejects.toThrow();
  await mutateWave(admin, "progress", wave.id, {
    delivered: 10,
    expectedVersion: 2,
  });
  await mutateWave(admin, "transition", wave.id, {
    status: "COMPLETED",
    expectedVersion: 3,
  });
});
it("prevents cross-tenant mutations and revoked staff writes", async () => {
  const wave = await mutateWave(admin, "create", undefined, draft());
  await expect(
    mutateWave(
      { ...admin, organizationId: "board-foreign" },
      "update",
      wave.id,
      { ...draft(), expectedVersion: 1 },
    ),
  ).rejects.toThrow();
  await expect(
    mutateWave(
      { ...admin, role: "DRIVER", driverId: "board-driver" },
      "create",
      undefined,
      draft(),
    ),
  ).rejects.toThrow();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: false },
  });
  await expect(
    mutateWave(admin, "create", undefined, draft()),
  ).rejects.toThrow();
  await database().membership.updateMany({
    where: { userId: admin.userId },
    data: { active: true },
  });
});
it("migrates legacy single-participant waves without changing their counts or status", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const index = migrations.findIndex((sql) =>
      sql.includes('CREATE TABLE "WaveParticipant"'),
    );
    expect(index).toBeGreaterThan(0);
    for (const sql of migrations.slice(0, index)) await legacy.exec(sql);
    await legacy.exec(`INSERT INTO "Organization" (id,name,"createdAt","updatedAt") VALUES ('legacy','Legacy',now(),now());
   INSERT INTO "DriverProfile" (id,"organizationId","firstName","lastName",email,"updatedAt") VALUES ('driver','legacy','Old','Driver','old@example.test',now());
   INSERT INTO "Vehicle" (id,"organizationId",plate,vin,brand,model,year,ownership,"inFleet","updatedAt") VALUES ('vehicle','legacy','OLD','VIN','VW','Van',2024,'OWNED','2026-01-01',now());
   INSERT INTO "Wave" (id,"organizationId",name,"startAt",packages,delivered,status,"driverId","vehicleId") VALUES ('wave','legacy','Legacy',now(),10,7,'ACTIVE','driver','vehicle');`);
    for (const sql of migrations.slice(index)) await legacy.exec(sql);
    const result = await legacy.query(
      `SELECT "driverId","vehicleId" FROM "WaveParticipant" WHERE "waveId"='wave'`,
    );
    expect(result.rows).toEqual([{ driverId: "driver", vehicleId: "vehicle" }]);
    expect(
      (
        await legacy.query(
          `SELECT packages,delivered,status FROM "Wave" WHERE id='wave'`,
        )
      ).rows,
    ).toEqual([{ packages: 10, delivered: 7, status: "ACTIVE" }]);
  } finally {
    await legacy.close();
  }
});

it("prevents archiving resources while they participate in an active wave", async () => {
  const wave = await mutateWave(admin, "create", undefined, draft([pair]));
  await mutateWave(admin, "transition", wave.id, {
    status: "ACTIVE",
    expectedVersion: 1,
  });
  await expect(
    mutateFleet(admin, "drivers", "archive", pair.driverId, {}),
  ).rejects.toThrow();
  await expect(
    mutateFleet(admin, "vehicles", "archive", pair.vehicleId, {}),
  ).rejects.toThrow();
});
