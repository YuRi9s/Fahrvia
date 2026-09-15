import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { investigate, safeDetails } from "../src/features/audit/service";
import { allowed, type Principal } from "../src/server/policy";
let engine: PGlite, socket: PGLiteSocketServer;
const p: Principal = {
  userId: "investigator",
  organizationId: "audit-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "audit@example.test",
  organizationName: "Fleet",
};
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5455,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5455/postgres";
  const db = database();
  await db.organization.create({
    data: { id: p.organizationId, name: "Fleet" },
  });
  await db.user.create({
    data: { id: p.userId, name: p.name, email: p.email },
  });
  await db.membership.create({
    data: { userId: p.userId, organizationId: p.organizationId, role: "ADMIN" },
  });
  await db.organization.create({ data: { id: "foreign", name: "Foreign" } });
  for (let n = 0; n < 31; n++)
    await db.auditLog.create({
      data: {
        id: `event-${String(n).padStart(2, "0")}`,
        organizationId: p.organizationId,
        actorId: p.userId,
        action: n === 0 ? "account-change" : "vehicle-change",
        resourceType: "vehicle",
        resourceId: `vehicle-${n}`,
        createdAt: new Date("2026-03-29T00:00:00Z"),
        details: { before: { status: "ACTIVE" }, token: "hidden" },
      },
    });
  await db.auditLog.create({
    data: {
      organizationId: "foreign",
      actorId: p.userId,
      action: "foreign",
      resourceType: "vehicle",
      resourceId: "foreign",
    },
  });
  await db.securityEvent.createMany({
    data: [
      {
        organizationId: p.organizationId,
        actorId: p.userId,
        kind: "account-access-changed",
        requestId: "ref-1",
        resourceId: "member-1",
      },
      { organizationId: "foreign", kind: "hidden", requestId: "foreign" },
      { kind: "legacy-unscoped", requestId: "old" },
    ],
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
});
const query = (s = "") => investigate(p, new URLSearchParams(s));
it("scopes both event sources and excludes legacy unscoped security events", async () => {
  expect((await query()).total).toBe(31);
  const r = await query("source=security");
  expect(r.total).toBe(1);
  expect(r.items[0].organizationId).toBe(p.organizationId);
});
it("uses stable pagination without duplicate tied timestamps", async () => {
  const a = await query(),
    b = await query("page=2");
  expect(a.items).toHaveLength(25);
  expect(b.items).toHaveLength(6);
  expect(new Set([...a.items, ...b.items].map((r) => r.id)).size).toBe(31);
});
it("combines exact filters across the full result set", async () => {
  const r = await query(
    "action=account-change&record=vehicle-0&actor=investigator",
  );
  expect(r.total).toBe(1);
  expect(r.items[0].id).toBe("event-00");
  expect(
    (await query("source=security&request=ref-1&record=member-1")).total,
  ).toBe(1);
});
it("uses inclusive Berlin days across daylight saving changes", async () => {
  expect((await query("from=2026-03-29&to=2026-03-29")).total).toBe(31);
  expect((await query("to=2026-03-28")).total).toBe(0);
});
it("rejects invalid filters", async () => {
  for (const q of [
    "source=unknown",
    "page=-1",
    "page=NaN",
    "from=wrong",
    "from=2026-03-30&to=2026-03-29",
    "request=ref-1",
  ])
    await expect(query(q)).rejects.toMatchObject({ status: 400 });
});
it("denies drivers and dispatchers and never grants writes", async () => {
  for (const role of ["DRIVER", "DISPATCHER"] as const)
    await expect(
      investigate({ ...p, role }, new URLSearchParams()),
    ).rejects.toMatchObject({ status: 403 });
  expect(allowed(p, "audit", "write")).toBe(false);
});
it("rechecks revoked membership even with a stale principal", async () => {
  await database().membership.updateMany({
    where: { userId: p.userId },
    data: { active: false },
  });
  try {
    await expect(query()).rejects.toMatchObject({ status: 403 });
  } finally {
    await database().membership.updateMany({
      where: { userId: p.userId },
      data: { active: true },
    });
  }
});
it("redacts nested sensitive metadata while retaining change evidence", async () => {
  expect(
    safeDetails({
      before: { password: "secret", status: "ACTIVE" },
      sessionToken: "secret",
    }),
  ).toEqual({
    before: { password: "[geschützt]", status: "ACTIVE" },
    sessionToken: "[geschützt]",
  });
  const r = await query("record=vehicle-0");
  expect(r.items[0].details).toEqual({
    before: { status: "ACTIVE" },
    token: "[geschützt]",
  });
});

it("security records reject updates and deletion", async () => {
  const row = await database().securityEvent.findFirstOrThrow({
    where: { organizationId: p.organizationId },
  });
  await expect(
    database().securityEvent.update({
      where: { id: row.id },
      data: { kind: "changed" },
    }),
  ).rejects.toThrow();
  await expect(
    database().securityEvent.delete({ where: { id: row.id } }),
  ).rejects.toThrow();
  expect((await query("source=security")).total).toBe(1);
});
