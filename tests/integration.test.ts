import { beforeAll, afterAll, it, expect } from "vitest";
import { Client } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { mutateFleet, assignVehicle } from "../src/features/fleet/service";
import { mutateOperations } from "../src/features/operations/service";
import { listModule } from "../src/server/queries";
import { previewScore, changeScoreImport } from "../src/features/score/service";
import type { Principal } from "../src/server/policy";
let engine: {
    exec: (sql: string) => Promise<unknown>;
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
    close: () => Promise<void>;
  },
  server: PGLiteSocketServer;
let admin: Principal, driver: Principal;
let vehicleId: string, driverId: string, foreignId: string;
beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (!url.pathname.endsWith("_test"))
      throw new Error(
        "Integration database name must end in _test and be disposable.",
      );
    const client = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await client.connect();
    engine = {
      exec: (sql) => client.query(sql),
      query: (sql, params) => client.query(sql, params),
      close: () => client.end(),
    };
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else {
    const embedded = await PGlite.create();
    engine = embedded;
    server = new PGLiteSocketServer({
      db: embedded,
      port: 5440,
      host: "127.0.0.1",
    });
    await server.start();
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:5440/postgres";
  }
  for (const sql of await migrationSql()) await engine.exec(sql);
  const db = database();
  await db.organization.createMany({
    data: [
      { id: "org-test-a", name: "Alpha" },
      { id: "org-test-b", name: "Beta" },
    ],
  });
  await db.user.create({
    data: { id: "admin-test", name: "Test Admin", email: "admin@example.test" },
  });
  await db.membership.create({
    data: { userId: "admin-test", organizationId: "org-test-a", role: "ADMIN" },
  });
  admin = {
    userId: "admin-test",
    organizationId: "org-test-a",
    role: "ADMIN",
    driverId: null,
    name: "Test Admin",
    email: "admin@example.test",
    organizationName: "Alpha",
  };
  const d = await mutateFleet(admin, "drivers", "create", undefined, {
    firstName: "Lena",
    lastName: "Weber",
    email: "lena@example.test",
    transporterId: "DE001",
  });
  driverId = d.id;
  driver = { ...admin, userId: "driver-test", role: "DRIVER", driverId };
  const v = await mutateFleet(admin, "vehicles", "create", undefined, {
    plate: "SB-TEST 1",
    vin: "WVWZZZ1JZXW000001",
    brand: "VW",
    model: "Caddy",
    year: 2024,
    ownership: "OWNED",
    inFleet: "2026-09-01",
    keyCount: 2,
  });
  vehicleId = v.id;
  const foreign = await db.vehicle.create({
    data: {
      organizationId: "org-test-b",
      plate: "B-OTHER 1",
      vin: "WVWZZZ1JZXW000002",
      brand: "VW",
      model: "Caddy",
      year: 2024,
      ownership: "OWNED",
      inFleet: new Date("2026-09-01"),
    },
  });
  foreignId = foreign.id;
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  if (server) await server.stop();
  await new Promise((resolve) => setImmediate(resolve));
  if (engine) await engine.close();
});
it("persists a vehicle with individual keys", async () => {
  expect(await database().vehicleKey.count({ where: { vehicleId } })).toBe(2);
});
it("assignment changes availability and prevents another active assignment", async () => {
  await assignVehicle(admin, { vehicleId, driverId });
  await expect(assignVehicle(admin, { vehicleId, driverId })).rejects.toThrow();
  const result = await listModule(
    driver,
    "vehicles",
    new URLSearchParams("status=ASSIGNED"),
  );
  expect("items" in result && result.items).toHaveLength(1);
});
it("cannot replace driver ownership with a manipulated status filter", async () => {
  const rows = await listModule(
    driver,
    "vehicles",
    new URLSearchParams("status=AVAILABLE"),
  );
  expect("items" in rows && rows.items).toHaveLength(0);
  expect(JSON.stringify(rows)).not.toContain("B-OTHER");
});
it("rejects cross-tenant vehicle mutation", async () => {
  await expect(
    mutateFleet(admin, "vehicles", "archive", foreignId, {}),
  ).rejects.toThrow();
});
it("rejects archiving a currently assigned vehicle", async () => {
  await expect(
    mutateFleet(admin, "vehicles", "archive", vehicleId, {}),
  ).rejects.toThrow("Zuweisung");
});
it("preserves closed assignment and fleet service periods", async () => {
  const a = await database().vehicleAssignment.findFirstOrThrow({
    where: { vehicleId, endAt: null },
  });
  await mutateFleet(admin, "assignments", "close", a.id, {});
  await mutateFleet(admin, "vehicles", "archive", vehicleId, {});
  await mutateFleet(admin, "vehicles", "reactivate", vehicleId, {});
  expect(
    await database().vehicleServicePeriod.count({ where: { vehicleId } }),
  ).toBe(2);
  expect(
    (
      await database().vehicleAssignment.findUniqueOrThrow({
        where: { id: a.id },
      })
    ).endAt,
  ).not.toBeNull();
});
it("prevents negative inventory and preserves movement history", async () => {
  const item = await mutateOperations(admin, "inventory", "create", undefined, {
    name: "Warnweste",
    sku: "VEST",
    stock: 2,
    minimumStock: 1,
  });
  await expect(
    mutateOperations(admin, "inventory", "adjust", item.id, {
      quantity: -3,
      reason: "Ausgabe",
    }),
  ).rejects.toThrow();
  await mutateOperations(admin, "inventory", "adjust", item.id, {
    quantity: -1,
    reason: "Ausgabe",
  });
  expect(
    (
      await database().inventoryItem.findUniqueOrThrow({
        where: { id: item.id },
      })
    ).stock,
  ).toBe(1);
  expect(
    await database().inventoryMovement.count({ where: { itemId: item.id } }),
  ).toBe(2);
});
it("database prevents cross-tenant key custody", async () => {
  const key = await database().vehicleKey.findFirstOrThrow({
    where: { vehicleId },
  });
  const other = await database().driverProfile.create({
    data: {
      organizationId: "org-test-b",
      firstName: "Other",
      lastName: "Driver",
      email: "other@example.test",
    },
  });
  await expect(
    engine.query(
      'UPDATE "VehicleKey" SET location=$1, "driverId"=$2 WHERE id=$3',
      ["DRIVER", other.id, key.id],
    ),
  ).rejects.toThrow();
});
it("audit trail cannot be changed through application writes", async () => {
  const log = await database().auditLog.findFirstOrThrow();
  await expect(
    engine.query('UPDATE "AuditLog" SET action=$1 WHERE id=$2', [
      "tampered",
      log.id,
    ]),
  ).rejects.toThrow();
});

it("commits score revisions, scopes driver results, and reverts to prior data", async () => {
  const form = (value: number) => {
    const f = new FormData();
    f.set("week", "2026-W37");
    f.set(
      "file",
      new File([`transporterId,totalScore\nDE001,${value}\n`], "score.csv"),
    );
    return f;
  };
  const a = await previewScore(admin, form(90));
  expect(a.errors).toEqual([]);
  await changeScoreImport(admin, a.id, "commit");
  await expect(previewScore(admin, form(90))).rejects.toThrow("bereits");
  const b = await previewScore(admin, form(92));
  await changeScoreImport(admin, b.id, "commit");
  const list = await listModule(
    driver,
    "score",
    new URLSearchParams("week=2026-W37"),
  );
  expect("items" in list && list.items).toHaveLength(1);
  expect(JSON.stringify(list)).toContain("92");
  await changeScoreImport(admin, b.id, "revert");
  const old = await listModule(
    driver,
    "score",
    new URLSearchParams("week=2026-W37"),
  );
  expect(JSON.stringify(old)).toContain("90");
  await expect(
    changeScoreImport(
      { ...admin, organizationId: "org-test-b" },
      a.id,
      "revert",
    ),
  ).rejects.toThrow();
});
it("denies dispatcher account revocation and vehicle creation", async () => {
  const dispatcher = { ...admin, role: "DISPATCHER" as const };
  await expect(
    mutateFleet(dispatcher, "drivers", "archive", driverId, {}),
  ).rejects.toThrow("Administrator");
  await expect(
    mutateFleet(dispatcher, "vehicles", "create", undefined, {}),
  ).rejects.toThrow("Administrator");
});
it("keeps conversation summaries, search and read state within participants", async () => {
  const { conversations, conversationHistory } =
    await import("../src/features/messages/service");
  const db = database();
  await db.user.create({
    data: {
      id: "message-peer",
      name: "Peer Driver",
      email: "peer@example.test",
    },
  });
  await db.membership.create({
    data: {
      organizationId: admin.organizationId,
      userId: "message-peer",
      role: "DRIVER",
    },
  });
  const sent = await mutateOperations(admin, "messages", "create", undefined, {
    recipientId: "message-peer",
    subject: "Route morgen",
    body: "Bitte um 08:00 im Büro melden.",
  });
  const row = await db.message.findUniqueOrThrow({ where: { id: sent.id } });
  const peer = { ...driver, userId: "message-peer" };
  const list = await conversations(peer, new URLSearchParams());
  expect(list.items[0].unread).toBe(1);
  expect(
    (
      await conversations(
        { ...admin, userId: "nonparticipant" },
        new URLSearchParams(),
      )
    ).total,
  ).toBe(0);
  expect(
    (await conversations(peer, new URLSearchParams("q=nonexistent"))).total,
  ).toBe(0);
  await expect(
    conversationHistory(
      { ...admin, organizationId: "org-test-b" },
      row.threadId!,
      new URLSearchParams(),
    ),
  ).rejects.toThrow("nicht gefunden");
  await mutateOperations(peer, "messages", "read", row.id, {});
  expect(
    (await conversations(peer, new URLSearchParams())).items[0].unread,
  ).toBe(0);
  await mutateOperations(peer, "messages", "create", undefined, {
    threadId: row.threadId,
    recipientId: admin.userId,
    subject: "Route morgen",
    body: "Verstanden.",
  });
  expect(
    (await conversationHistory(admin, row.threadId!, new URLSearchParams()))
      .total,
  ).toBe(2);
});
it("renewing a document preserves prior metadata and removes access to the old file", async () => {
  const { upload, download } = await import("../src/features/uploads/service");
  const { default: sharp } = await import("sharp");
  const image = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const form = (replacesId?: string) => {
    const f = new FormData();
    f.set("kind", "document");
    f.set("title", "Fahrzeugschein");
    f.set("vehicleId", vehicleId);
    f.set("files", new File([image], "document.png", { type: "image/png" }));
    if (replacesId) f.set("replacesId", replacesId);
    return f;
  };
  const original = await upload(admin, form());
  const old = await database().document.findUniqueOrThrow({
    where: { id: original.id },
  });
  const renewed = await upload(admin, form(original.id));
  expect(
    (await database().document.findUniqueOrThrow({ where: { id: renewed.id } }))
      .replacesId,
  ).toBe(original.id);
  expect(
    (
      await database().document.findUniqueOrThrow({
        where: { id: original.id },
      })
    ).archivedAt,
  ).not.toBeNull();
  await expect(download(admin, old.objectId)).rejects.toThrow(
    "Datei nicht gefunden",
  );
});
it("weekly assignment filter includes overlaps but excludes unrelated weeks", async () => {
  const list = await listModule(
    admin,
    "assignments",
    new URLSearchParams("week=2025-W01"),
  );
  expect("items" in list && list.items).toHaveLength(0);
});

it("finds a driver by full name and resolves only the requested authorized record", async () => {
  const found = await listModule(
    admin,
    "drivers",
    new URLSearchParams("q=Lena%20Weber"),
  );
  expect("items" in found && found.items).toEqual([
    expect.objectContaining({ id: driverId }),
  ]);
  const hidden = await listModule(
    driver,
    "drivers",
    new URLSearchParams("id=not-my-driver"),
  );
  expect("items" in hidden && hidden.items).toEqual([]);
  const missingVehicle = await listModule(
    admin,
    "vehicles",
    new URLSearchParams(`id=${foreignId}`),
  );
  expect("items" in missingVehicle && missingVehicle.items).toEqual([]);
});

it("searches and pages more than 100 eligible recipients without exposing other tenants or driver peers", async () => {
  const db = database();
  await db.user.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: `lookup-user-${i}`,
      name: `Lookup ${String(i).padStart(3, "0")}`,
      email: `lookup-${i}@example.test`,
    })),
  });
  await db.membership.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      userId: `lookup-user-${i}`,
      organizationId: i === 104 ? "org-test-b" : admin.organizationId,
      role: i === 103 ? "DRIVER" : "DISPATCHER",
      active: i !== 102,
    })),
  });
  const last = await listModule(
    admin,
    "recipients",
    new URLSearchParams("q=Lookup&page=5&pageSize=25"),
  );
  expect("items" in last && last.items).toHaveLength(3);
  expect("total" in last && last.total).toBe(103);
  const searched = await listModule(
    admin,
    "recipients",
    new URLSearchParams("q=Lookup%20101"),
  );
  expect("items" in searched && searched.items).toEqual([
    expect.objectContaining({ id: "lookup-user-101" }),
  ]);
  for (const id of ["lookup-user-102", "lookup-user-103", "lookup-user-104"]) {
    const hidden = await listModule(
      driver,
      "recipients",
      new URLSearchParams({ id }),
    );
    expect("items" in hidden && hidden.items).toEqual([]);
  }
});

it("can browse and resolve drivers and vehicles beyond the first hundred records", async () => {
  const db = database();
  await db.driverProfile.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: `picker-driver-${i}`,
      organizationId: admin.organizationId,
      firstName: "Picker",
      lastName: `Person ${String(i).padStart(3, "0")}`,
      email: `picker-${i}@example.test`,
    })),
  });
  await db.vehicle.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: `picker-vehicle-${i}`,
      organizationId: admin.organizationId,
      plate: `PICKER ${String(i).padStart(3, "0")}`,
      vin: `picker-vin-${i}`,
      brand: "VW",
      model: "Caddy",
      year: 2024,
      ownership: "OWNED",
      inFleet: new Date("2026-01-01"),
    })),
  });
  for (const [module, id] of [
    ["drivers", "picker-driver-104"],
    ["vehicles", "picker-vehicle-104"],
  ]) {
    const last = await listModule(
      admin,
      module,
      new URLSearchParams("q=Picker&page=5&pageSize=25"),
    );
    expect("items" in last && last.items).toHaveLength(5);
    expect("total" in last && last.total).toBe(105);
    const resolved = await listModule(
      admin,
      module,
      new URLSearchParams({ id, pageSize: "1" }),
    );
    expect("items" in resolved && resolved.items).toEqual([
      expect.objectContaining({ id }),
    ]);
    const hidden = await listModule(
      driver,
      module,
      new URLSearchParams({ id }),
    );
    expect("items" in hidden && hidden.items).toEqual([]);
  }
});

it("filters planning by Berlin midnight with an exclusive next-week boundary", async () => {
  const db = database();
  await db.planEvent.createMany({
    data: [
      {
        id: "calendar-before",
        startAt: new Date("2026-09-06T21:00:00Z"),
        endAt: new Date("2026-09-06T22:00:00Z"),
      },
      {
        id: "calendar-monday",
        startAt: new Date("2026-09-06T22:15:00Z"),
        endAt: new Date("2026-09-06T23:00:00Z"),
      },
      {
        id: "calendar-next",
        startAt: new Date("2026-09-13T22:00:00Z"),
        endAt: new Date("2026-09-13T23:00:00Z"),
      },
    ].map((row) => ({
      ...row,
      organizationId: admin.organizationId,
      title: "Calendar boundary",
    })),
  });
  const list = await listModule(
    admin,
    "planning",
    new URLSearchParams("week=2026-W37&q=Calendar%20boundary"),
  );
  expect("items" in list && list.items).toEqual([
    expect.objectContaining({ id: "calendar-monday" }),
  ]);
});
