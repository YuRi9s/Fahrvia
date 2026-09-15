import { listOptions } from "../src/lib/list-options";
import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { listModule } from "../src/server/queries";
import { parseListOptions } from "../src/server/list-options";
import type { Principal } from "../src/server/policy";
let engine: PGlite, socket: PGLiteSocketServer;
const admin: Principal = {
  userId: "lists-admin",
  organizationId: "lists-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "lists@example.test",
  organizationName: "Fleet",
};
const driver: Principal = { ...admin, role: "DRIVER", driverId: "driver-00" };
async function list(module: string, q = "", p = admin) {
  return (await listModule(p, module, new URLSearchParams(q))) as {
    items: Record<string, unknown>[];
    total: number;
    page: number;
    pageSize: number;
  };
}
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5456,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5456/postgres";
  const db = database();
  await db.organization.createMany({
    data: [
      { id: admin.organizationId, name: "Fleet" },
      { id: "foreign-list", name: "Foreign" },
    ],
  });
  await db.user.create({
    data: { id: admin.userId, email: admin.email, name: admin.name },
  });
  for (let i = 0; i < 32; i++) {
    const n = String(i).padStart(2, "0");
    await db.driverProfile.create({
      data: {
        id: `driver-${n}`,
        organizationId: admin.organizationId,
        firstName: "Same",
        lastName: "Name",
        email: `driver-${n}@example.test`,
      },
    });
    await db.inventoryItem.create({
      data: {
        organizationId: admin.organizationId,
        name: `Item ${n}`,
        sku: `SKU${n}`,
        stock: i,
        minimumStock: 0,
      },
    });
  }
  for (const [id, org] of [
    ["own", admin.organizationId],
    ["peer", admin.organizationId],
    ["foreign", "foreign-list"],
  ])
    await db.vehicle.create({
      data: {
        id,
        organizationId: org,
        plate: id,
        vin: id,
        brand: "VW",
        model: "Van",
        year: 2025,
        ownership: "OWNED",
        inFleet: new Date("2026-01-01"),
      },
    });
  await db.vehicleAssignment.createMany({
    data: [
      {
        organizationId: admin.organizationId,
        vehicleId: "own",
        driverId: "driver-00",
        startAt: new Date("2026-01-01"),
        createdBy: admin.userId,
      },
      {
        organizationId: admin.organizationId,
        vehicleId: "peer",
        driverId: "driver-01",
        startAt: new Date("2026-01-01"),
        createdBy: admin.userId,
      },
    ],
  });
  const now = Date.now();
  for (const [id, days, owner] of [
    ["expired", -3, "driver-00"],
    ["soon", 10, "driver-00"],
    ["valid", 60, "driver-00"],
    ["none", null, "driver-00"],
    ["peer-doc", -3, "driver-01"],
  ] as const) {
    const object = await db.storedObject.create({
      data: {
        organizationId: admin.organizationId,
        key: id,
        filename: `${id}.pdf`,
        mime: "application/pdf",
        size: 100,
        status: "READY",
        createdBy: admin.userId,
      },
    });
    await db.document.create({
      data: {
        id,
        organizationId: admin.organizationId,
        title: id,
        driverId: owner,
        objectId: object.id,
        expiresAt: days === null ? null : new Date(now + days * 86400000),
      },
    });
  }
  const source = await db.scoreImport.create({
    data: {
      organizationId: admin.organizationId,
      week: "2026-W10",
      filename: "fixture.csv",
      hash: "fixture",
      mapping: {},
      rows: [],
      errors: [],
      status: "COMMITTED",
      createdBy: admin.userId,
    },
  });
  for (let i = 0; i < 32; i++)
    await db.driverScore.create({
      data: {
        organizationId: admin.organizationId,
        importId: source.id,
        driverId: `driver-${String(i).padStart(2, "0")}`,
        week: "2026-W10",
        rank: i + 1,
        totalScore: i,
        metrics: {},
        status: i === 31 ? "Review" : "Good",
      },
    });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
});
it("sorts numerical values across the entire inventory before pagination", async () => {
  const a = await list("inventory", "sort=stock&dir=desc&pageSize=10"),
    b = await list("inventory", "sort=stock&dir=desc&pageSize=10&page=2");
  expect(a.total).toBe(32);
  expect(a.items.map((r) => r.stock)).toEqual([
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22,
  ]);
  expect(b.items[0].stock).toBe(21);
});
it("uses stable ties across driver pages", async () => {
  const a = await list("drivers", "sort=lastName"),
    b = await list("drivers", "sort=lastName&page=2");
  expect(new Set([...a.items, ...b.items].map((r) => r.id)).size).toBe(32);
  expect(a.items[0].id).toBe("driver-00");
});
it("filters derived document statuses and totals consistently", async () => {
  expect((await list("documents", "status=EXPIRED")).total).toBe(2);
  expect(
    (await list("documents", "status=EXPIRING")).items.map((r) => r.id),
  ).toEqual(["soon"]);
  const valid = await list("documents", "status=VALID");
  expect(valid.total).toBe(2);
  expect(valid.items.every((r) => r.status === "VALID")).toBe(true);
});
it("combines document search/status with driver ownership", async () => {
  const r = await list("documents", "status=EXPIRED&q=expired", driver);
  expect(r.total).toBe(1);
  expect(r.items[0].id).toBe("expired");
  expect((await list("documents", "status=EXPIRED&q=peer", driver)).total).toBe(
    0,
  );
});
it("filters source-defined score statuses beyond the first page", async () => {
  const r = await list(
    "score",
    "week=2026-W10&status=Review&sort=totalScore&dir=desc",
  );
  expect(r.total).toBe(1);
  expect(r.items[0].rank).toBe(32);
  expect(
    (await list("score", "week=2026-W10&status=Review", driver)).total,
  ).toBe(0);
});
it("retains driver ownership while applying vehicle status filters", async () => {
  const r = await list("vehicles", "status=ASSIGNED&sort=plate", driver);
  expect(r.items.map((r) => r.id)).toEqual(["own"]);
  expect((await list("vehicles", "status=AVAILABLE", driver)).total).toBe(0);
  expect((await list("vehicles", "status=INACTIVE", driver)).total).toBe(0);
});
it("filters and sorts the complete report aggregate", async () => {
  const r = await list("reports", "q=Fahrzeuge&sort=value&dir=desc&pageSize=1");
  expect(r.total).toBe(2);
  expect(r.items).toHaveLength(1);
  expect(r.items[0].value).toBe(2);
});
it("rejects unsupported sort/status and invalid pagination", async () => {
  for (const q of [
    "sort=password",
    "dir=sideways",
    "status=NOPE",
    "page=-1",
    "pageSize=101",
  ])
    await expect(list("vehicles", q)).rejects.toMatchObject({ status: 400 });
  expect(() =>
    parseListOptions("inventory", new URLSearchParams("status=ACTIVE")),
  ).toThrow();
});
it("allows an empty status result without changing available filter choices", async () => {
  const r = await list("drivers", "status=INACTIVE");
  expect(r.total).toBe(0);
  expect(r.items).toEqual([]);
  expect(
    parseListOptions("drivers", new URLSearchParams("status=ACTIVE"))?.status,
  ).toBe("ACTIVE");
});

it("executes every advertised database sort in both directions", async () => {
  for (const [module, config] of Object.entries(listOptions))
    for (const sort of config.sorts)
      for (const dir of ["asc", "desc"]) {
        const r = await list(
          module,
          `sort=${sort}&dir=${dir}${module === "score" ? "&week=2026-W10" : ""}`,
        );
        expect(r.items, `${module}:${sort}:${dir}`).toBeInstanceOf(Array);
      }
}, 30000);
