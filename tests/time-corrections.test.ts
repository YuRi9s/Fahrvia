import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { randomUUID } from "node:crypto";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import type { Principal } from "../src/server/policy";
import {
  correctionCommand,
  corrections,
} from "../src/features/work-time/corrections";
import { download } from "../src/features/uploads/service";
vi.mock("../src/features/uploads/storage", () => ({
  retrieveBytes: vi.fn(async () => new Uint8Array([1])),
  storeBytes: vi.fn(),
  removeBytes: vi.fn(),
  scanPdf: vi.fn(),
}));
let engine: PGlite, server: PGLiteSocketServer;
const driver: Principal = {
  userId: "correction-driver",
  driverId: "correction-profile",
  organizationId: "correction-org",
  role: "DRIVER",
  name: "Driver",
  email: "driver@correction.test",
  organizationName: "Fleet",
};
const admin: Principal = {
  ...driver,
  userId: "correction-admin",
  driverId: null,
  role: "ADMIN",
  email: "admin@correction.test",
};
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  server = new PGLiteSocketServer({
    db: engine,
    port: 5467,
    host: "127.0.0.1",
  });
  await server.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5467/postgres";
  const db = database();
  await db.organization.create({
    data: { id: driver.organizationId, name: "Fleet" },
  });
  for (const p of [driver, admin]) {
    await db.user.create({
      data: { id: p.userId, email: p.email, name: p.name },
    });
    await db.membership.create({
      data: {
        id: p.userId + "-member",
        userId: p.userId,
        organizationId: p.organizationId,
        role: p.role,
      },
    });
  }
  await db.driverProfile.create({
    data: {
      id: driver.driverId!,
      organizationId: driver.organizationId,
      membershipId: driver.userId + "-member",
      firstName: "Test",
      lastName: "Driver",
      email: driver.email,
    },
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await server?.stop();
  await engine?.close();
});
let day = 0;
async function entry() {
  day++;
  const start = new Date(Date.UTC(2025, 0, day, 9));
  return database().workTimeEntry.create({
    data: {
      organizationId: driver.organizationId,
      driverId: driver.driverId!,
      startAt: start,
      endAt: new Date(+start + 8 * 3600000),
      breakMilliseconds: 1800000n,
      breakMinutes: 30,
      clockState: "FINISHED",
      status: "SUBMITTED",
    },
  });
}
function proposal(e: {
  id: string;
  version: number;
  startAt: Date;
  endAt: Date | null;
}) {
  return {
    action: "request",
    requestId: randomUUID(),
    entryId: e.id,
    expectedVersion: e.version,
    startAt: new Date(+e.startAt - 3600000).toISOString(),
    endAt: e.endAt!.toISOString(),
    breakMilliseconds: 1800000,
    reason: "App was unavailable; actual start was earlier.",
    evidenceDocumentId: null,
  };
}
const decide = (id: string, decision = "APPROVED") => ({
  action: "decide",
  id,
  decision,
  requestId: randomUUID(),
  reason: "Checked with shift supervisor.",
});
it("employee proposal does not mutate the shift; approval records before/after and resets approval", async () => {
  const e = await entry();
  await database().workTimeEntry.update({
    where: { id: e.id },
    data: {
      status: "APPROVED",
      approvedBy: admin.userId,
      approvedAt: new Date(),
    },
  });
  const p = proposal(e);
  const r = await correctionCommand(driver, p);
  expect(
    (await database().workTimeEntry.findUniqueOrThrow({ where: { id: e.id } }))
      .startAt,
  ).toEqual(e.startAt);
  await correctionCommand(admin, decide(r.id));
  const changed = await database().workTimeEntry.findUniqueOrThrow({
    where: { id: e.id },
  });
  expect(changed.startAt.toISOString()).toBe(p.startAt);
  expect(changed.status).toBe("SUBMITTED");
  expect(changed.approvedBy).toBeNull();
  expect(changed.version).toBe(e.version + 1);
  const saved = await database().workTimeCorrection.findUniqueOrThrow({
    where: { id: r.id },
  });
  expect(saved.before).toBeTruthy();
  expect(saved.after).toBeTruthy();
  expect(
    await database().workTimeRevision.count({ where: { entryId: e.id } }),
  ).toBe(1);
});
it("request and decision retries are idempotent; reused IDs cannot change content", async () => {
  const e = await entry(),
    p = proposal(e);
  const r = await correctionCommand(driver, p);
  expect(await correctionCommand(driver, p)).toEqual(r);
  await expect(
    correctionCommand(driver, { ...p, reason: "Different reason" }),
  ).rejects.toMatchObject({ status: 409 });
  const d = decide(r.id);
  await correctionCommand(admin, d);
  await correctionCommand(admin, d);
  expect(
    await database().workTimeRevision.count({ where: { entryId: e.id } }),
  ).toBe(1);
  await expect(
    correctionCommand(admin, { ...d, decision: "REJECTED" }),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects stale approval without changing data, but permits a reasoned rejection", async () => {
  const e = await entry(),
    r = await correctionCommand(driver, proposal(e));
  await database().workTimeEntry.update({
    where: { id: e.id },
    data: { version: { increment: 1 } },
  });
  await expect(correctionCommand(admin, decide(r.id))).rejects.toMatchObject({
    status: 409,
  });
  await correctionCommand(admin, decide(r.id, "REJECTED"));
  expect(
    (await database().workTimeEntry.findUniqueOrThrow({ where: { id: e.id } }))
      .startAt,
  ).toEqual(e.startAt);
});
it("restricts requests and decisions using live membership and rejects dispatchers", async () => {
  const e = await entry();
  await expect(correctionCommand(admin, proposal(e))).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    corrections({ ...admin, role: "DISPATCHER" }, new URLSearchParams()),
  ).rejects.toMatchObject({ status: 403 });
  const r = await correctionCommand(driver, proposal(e));
  await expect(correctionCommand(driver, decide(r.id))).rejects.toMatchObject({
    status: 403,
  });
  await database().membership.update({
    where: { id: admin.userId + "-member" },
    data: { active: false },
  });
  await expect(correctionCommand(admin, decide(r.id))).rejects.toMatchObject({
    status: 403,
  });
  await database().membership.update({
    where: { id: admin.userId + "-member" },
    data: { active: true },
  });
});
it("blocks duplicate pending requests and invalid or future intervals", async () => {
  const e = await entry(),
    p = proposal(e);
  await expect(
    correctionCommand(driver, { ...p, endAt: p.startAt }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    correctionCommand(driver, { ...p, endAt: "2099-01-01T00:00:00.000Z" }),
  ).rejects.toMatchObject({ status: 422 });
  await correctionCommand(driver, p);
  await expect(
    correctionCommand(driver, { ...p, requestId: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
});
it("rechecks overlapping work intervals when approving", async () => {
  const e = await entry(),
    r = await correctionCommand(driver, proposal(e));
  await database().workTimeEntry.create({
    data: {
      organizationId: driver.organizationId,
      driverId: driver.driverId!,
      startAt: new Date(+e.startAt - 7200000),
      endAt: new Date(+e.startAt - 1800000),
      status: "SUBMITTED",
    },
  });
  await expect(correctionCommand(admin, decide(r.id))).rejects.toMatchObject({
    status: 409,
  });
});
it("peer and other-tenant access cannot expose or modify requests", async () => {
  const e = await entry(),
    r = await correctionCommand(driver, proposal(e));
  await expect(
    corrections(
      { ...driver, organizationId: "other-org" },
      new URLSearchParams(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await database().driverProfile.create({
    data: {
      id: "peer-profile",
      organizationId: driver.organizationId,
      firstName: "Peer",
      lastName: "Private",
      email: "peer@test.test",
    },
  });
  const peer = await database().workTimeEntry.create({
    data: {
      organizationId: driver.organizationId,
      driverId: "peer-profile",
      startAt: new Date("2024-01-01T09:00Z"),
      endAt: new Date("2024-01-01T17:00Z"),
    },
  });
  await expect(correctionCommand(driver, proposal(peer))).rejects.toMatchObject(
    { status: 404 },
  );
  expect(
    JSON.stringify(await corrections(driver, new URLSearchParams())),
  ).not.toContain(peer.id);
  await expect(
    correctionCommand({ ...admin, organizationId: "foreign" }, decide(r.id)),
  ).rejects.toMatchObject({ status: 403 });
});
it("pins only own ready document evidence, keeps it after archival, and preserves immutable review data", async () => {
  const db = database(),
    e = await entry();
  const object = await db.storedObject.create({
    data: {
      organizationId: driver.organizationId,
      key: randomUUID(),
      filename: "proof.jpg",
      mime: "image/jpeg",
      size: 10,
      status: "READY",
      driverId: driver.driverId,
      createdBy: driver.userId,
    },
  });
  const doc = await db.document.create({
    data: {
      organizationId: driver.organizationId,
      driverId: driver.driverId,
      title: "Proof",
      objectId: object.id,
    },
  });
  const r = await correctionCommand(driver, {
    ...proposal(e),
    evidenceDocumentId: doc.id,
  });
  await db.document.update({
    where: { id: doc.id },
    data: { archivedAt: new Date() },
  });
  expect(
    (await corrections(driver, new URLSearchParams())).items.find(
      (x) => x.id === r.id,
    )?.evidence?.id,
  ).toBe(object.id);
  await expect(
    engine.query(
      "UPDATE \"WorkTimeCorrection\" SET reason='changed' WHERE id=$1",
      [r.id],
    ),
  ).rejects.toThrow();
  expect((await download(driver, object.id)).bytes).toEqual(
    new Uint8Array([1]),
  );
  expect((await download(admin, object.id)).bytes).toEqual(new Uint8Array([1]));
  await expect(
    download({ ...admin, role: "DISPATCHER" }, object.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    download(
      { ...driver, driverId: "peer-profile", userId: "other-user" },
      object.id,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await correctionCommand(admin, decide(r.id, "REJECTED"));
  await expect(
    engine.query('DELETE FROM "WorkTimeCorrection" WHERE id=$1', [r.id]),
  ).rejects.toThrow();
});
it("rejects peer evidence and open shifts", async () => {
  const e = await entry(),
    db = database();
  const o = await db.storedObject.create({
    data: {
      organizationId: driver.organizationId,
      key: randomUUID(),
      filename: "private.jpg",
      mime: "image/jpeg",
      size: 10,
      status: "READY",
      driverId: "peer-profile",
      createdBy: admin.userId,
    },
  });
  const doc = await db.document.create({
    data: {
      organizationId: driver.organizationId,
      driverId: "peer-profile",
      title: "Private",
      objectId: o.id,
    },
  });
  await expect(
    correctionCommand(driver, { ...proposal(e), evidenceDocumentId: doc.id }),
  ).rejects.toMatchObject({ status: 404 });
  await db.workTimeEntry.update({
    where: { id: e.id },
    data: { endAt: null, clockState: "RUNNING", status: "OPEN" },
  });
  await expect(correctionCommand(driver, proposal(e))).rejects.toMatchObject({
    status: 409,
  });
  await db.workTimeEntry.update({
    where: { id: e.id },
    data: { endAt: e.endAt, clockState: "FINISHED", status: "SUBMITTED" },
  });
});
it("preserves original clock events and rejects a promoted employee reviewing their own request", async () => {
  const e = await entry();
  await database().workTimeClockEvent.create({
    data: {
      entryId: e.id,
      actorId: driver.userId,
      requestId: randomUUID(),
      action: "start",
      occurredAt: e.startAt,
    },
  });
  const r = await correctionCommand(driver, proposal(e));
  await database().membership.update({
    where: { id: driver.userId + "-member" },
    data: { role: "ADMIN" },
  });
  await expect(
    correctionCommand({ ...driver, role: "ADMIN" }, decide(r.id)),
  ).rejects.toMatchObject({ status: 403 });
  await database().membership.update({
    where: { id: driver.userId + "-member" },
    data: { role: "DRIVER" },
  });
  await correctionCommand(admin, decide(r.id));
  expect(
    (
      await database().workTimeClockEvent.findFirstOrThrow({
        where: { entryId: e.id },
      })
    ).occurredAt,
  ).toEqual(e.startAt);
  await expect(
    engine.query(
      'UPDATE "WorkTimeCorrection" SET "decisionReason"=\'Changed review reason\' WHERE id=$1',
      [r.id],
    ),
  ).rejects.toThrow();
});
it("denies another active tenant and scopes an actual peer request out of the list", async () => {
  const db = database();
  await db.organization.create({
    data: { id: "foreign-correction-org", name: "Foreign" },
  });
  await db.membership.create({
    data: {
      userId: admin.userId,
      organizationId: "foreign-correction-org",
      role: "ADMIN",
    },
  });
  const e = await entry(),
    r = await correctionCommand(driver, proposal(e));
  await expect(
    correctionCommand(
      { ...admin, organizationId: "foreign-correction-org" },
      decide(r.id),
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (
      await corrections(
        { ...admin, organizationId: "foreign-correction-org" },
        new URLSearchParams(),
      )
    ).items,
  ).toHaveLength(0);
  const peerId = "actual-peer";
  await db.user.create({
    data: { id: peerId, email: "actual-peer@test.test", name: "Peer" },
  });
  const membership = await db.membership.create({
    data: {
      userId: peerId,
      organizationId: driver.organizationId,
      role: "DRIVER",
    },
  });
  await db.driverProfile.update({
    where: { id: "peer-profile" },
    data: { membershipId: membership.id },
  });
  const peerEntry = await db.workTimeEntry.findFirstOrThrow({
    where: { driverId: "peer-profile" },
  });
  const peerRequest = await correctionCommand(
    { ...driver, userId: peerId, driverId: "peer-profile" },
    { ...proposal(peerEntry), breakMilliseconds: 0 },
  );
  expect(
    JSON.stringify(await corrections(driver, new URLSearchParams())),
  ).not.toContain(peerRequest.id);
});
it("rejects no-op proposals and preserves whole-minute legacy time accounting", async () => {
  const db = database(),
    e = await entry();
  await expect(
    correctionCommand(driver, {
      ...proposal(e),
      startAt: e.startAt.toISOString(),
    }),
  ).rejects.toMatchObject({ status: 422 });
  await db.workTimeEntry.update({
    where: { id: e.id },
    data: { clockState: null, breakMilliseconds: 0n },
  });
  await expect(
    correctionCommand(driver, { ...proposal(e), breakMilliseconds: 1 }),
  ).rejects.toMatchObject({ status: 422 });
  const r = await correctionCommand(driver, proposal(e));
  await correctionCommand(admin, decide(r.id));
  const final = await db.workTimeEntry.findUniqueOrThrow({
    where: { id: e.id },
  });
  expect(final.breakMinutes).toBe(30);
  expect(final.breakMilliseconds).toBe(0n);
  expect(final.clockState).toBeNull();
});
