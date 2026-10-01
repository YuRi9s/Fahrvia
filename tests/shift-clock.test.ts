import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { randomUUID } from "node:crypto";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { listModule } from "../src/server/queries";
import { allowed, type Principal } from "../src/server/policy";
import { mutateOperations } from "../src/features/operations/service";
import { clockCommand, clockSnapshot } from "../src/features/work-time/clock";
let engine: PGlite, server: PGLiteSocketServer;
const p: Principal = {
  userId: "clock-user",
  driverId: "clock-driver",
  organizationId: "clock-org",
  role: "DRIVER",
  name: "Clock Driver",
  email: "clock@example.test",
  organizationName: "Clock Fleet",
};
const command = (
  action: string,
  entryId?: string,
  expectedVersion?: number,
) => ({
  action,
  requestId: randomUUID(),
  ...(entryId ? { entryId, expectedVersion } : {}),
});
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  server = new PGLiteSocketServer({
    db: engine,
    port: 5468,
    host: "127.0.0.1",
  });
  await server.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5468/postgres";
  const db = database();
  await db.organization.createMany({
    data: [
      { id: p.organizationId, name: p.organizationName },
      { id: "other-org", name: "Other" },
    ],
  });
  await db.user.create({
    data: { id: p.userId, name: p.name, email: p.email },
  });
  const member = await db.membership.create({
    data: {
      id: "clock-member",
      userId: p.userId,
      organizationId: p.organizationId,
      role: "DRIVER",
    },
  });
  await db.driverProfile.create({
    data: {
      id: p.driverId!,
      organizationId: p.organizationId,
      membershipId: member.id,
      firstName: "Clock",
      lastName: "Driver",
      email: p.email,
    },
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await server?.stop();
  await engine?.close();
});
it("keeps generic employee work-time mutations forbidden", async () => {
  expect(allowed(p, "work-times", "write")).toBe(false);
  await expect(
    mutateOperations(p, "work-times", "create", undefined, {}),
  ).rejects.toMatchObject({ status: 403 });
});
it("records start, multiple breaks, resume and finish without trusting client times", async () => {
  const before = Date.now();
  let state = await clockCommand(p, command("start"));
  expect(state.entry!.state).toBe("RUNNING");
  expect(new Date(state.entry!.startAt).getTime()).toBeGreaterThanOrEqual(
    before,
  );
  await expect(
    clockCommand(p, {
      ...command("pause", state.entry!.id, state.entry!.version),
      startAt: "2000-01-01",
    }),
  ).rejects.toMatchObject({ status: 400 });
  for (let i = 0; i < 2; i++) {
    state = await clockCommand(
      p,
      command("pause", state.entry!.id, state.entry!.version),
    );
    expect(state.entry!.state).toBe("PAUSED");
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = await clockCommand(
      p,
      command("resume", state.entry!.id, state.entry!.version),
    );
  }
  state = await clockCommand(
    p,
    command("finish", state.entry!.id, state.entry!.version),
  );
  expect(state.entry!.state).toBe("FINISHED");
  expect(state.entry!.breakMilliseconds).toBeGreaterThan(0);
  expect(state.entry!.events.map((e) => e.action)).toEqual([
    "start",
    "pause",
    "resume",
    "pause",
    "resume",
    "finish",
  ]);
  expect(
    await database().workTimeEntry.findUnique({
      where: { id: state.entry!.id },
    }),
  ).toMatchObject({ status: "SUBMITTED" });
});
it("replays an identical request once, rejects a reused key with different content and rejects stale actions", async () => {
  const start = command("start");
  const a = await clockCommand(p, start);
  const b = await clockCommand(p, start);
  expect(b.entry!.id).toBe(a.entry!.id);
  expect(
    await database().workTimeClockEvent.count({
      where: { requestId: start.requestId },
    }),
  ).toBe(1);
  await expect(
    clockCommand(p, {
      ...start,
      action: "finish",
      entryId: a.entry!.id,
      expectedVersion: a.entry!.version,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const paused = await clockCommand(
    p,
    command("pause", a.entry!.id, a.entry!.version),
  );
  await expect(
    clockCommand(p, command("resume", a.entry!.id, a.entry!.version)),
  ).rejects.toMatchObject({ status: 409 });
  const finished = await clockCommand(
    p,
    command("finish", paused.entry!.id, paused.entry!.version),
  );
  expect(finished.entry!.state).toBe("FINISHED");
  expect(finished.entry!.events.at(-1)!.action).toBe("finish");
  await expect(
    clockCommand(
      p,
      command("resume", finished.entry!.id, finished.entry!.version),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects foreign records and checks live membership and driver status", async () => {
  await expect(
    clockSnapshot({ ...p, organizationId: "other-org" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    clockCommand({ ...p, role: "ADMIN" }, command("start")),
  ).rejects.toMatchObject({ status: 403 });
  await database().membership.update({
    where: { id: "clock-member" },
    data: { active: false },
  });
  await expect(clockCommand(p, command("start"))).rejects.toMatchObject({
    status: 403,
  });
  await database().membership.update({
    where: { id: "clock-member" },
    data: { active: true },
  });
});
it("blocks a second active shift and never edits another entry by identifier", async () => {
  const current = await clockCommand(p, command("start"));
  await expect(clockCommand(p, command("start"))).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    clockCommand(p, command("finish", "foreign-entry", 1)),
  ).rejects.toMatchObject({ status: 404 });
  const snapshot = await clockSnapshot(p);
  expect(snapshot.entry!.id).toBe(current.entry!.id);
  await clockCommand(
    p,
    command("finish", current.entry!.id, current.entry!.version),
  );
});
it("preserves clock history against generic administrator edits and event deletion", async () => {
  const snapshot = await clockSnapshot(p);
  await expect(
    mutateOperations(
      { ...p, role: "ADMIN" },
      "work-times",
      "update",
      snapshot.entry!.id,
      {},
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.query('DELETE FROM "WorkTimeClockEvent" WHERE "entryId"=$1', [
      snapshot.entry!.id,
    ]),
  ).rejects.toThrow();
});
it("keeps legacy entries intact, blocks starting over an open manual entry and preserves manual corrections", async () => {
  const db = database();
  const manual = await db.workTimeEntry.create({
    data: {
      organizationId: p.organizationId,
      driverId: p.driverId!,
      startAt: new Date("2020-01-01T08:00:00Z"),
    },
  });
  expect((await clockSnapshot(p)).blockedByManualEntry).toBe(true);
  await expect(clockCommand(p, command("start"))).rejects.toMatchObject({
    status: 409,
  });
  await mutateOperations(
    { ...p, role: "ADMIN" },
    "work-times",
    "update",
    manual.id,
    {
      driverId: p.driverId,
      startAt: "2020-01-01T08:00:00Z",
      endAt: "2020-01-01T16:00:00Z",
      breakMinutes: 30,
      reason: "Close legacy fixture",
    },
  );
  expect(
    (await db.workTimeEntry.findUniqueOrThrow({ where: { id: manual.id } }))
      .clockState,
  ).toBeNull();
  expect(
    await db.workTimeRevision.count({ where: { entryId: manual.id } }),
  ).toBe(1);
  await expect(
    engine.query(
      'UPDATE "WorkTimeEntry" SET "breakMilliseconds"=1 WHERE id=$1',
      [manual.id],
    ),
  ).rejects.toThrow(/clock_state_valid/);
});
it("adds the final open break when ending a paused shift and exposes exact totals", async () => {
  let value = await clockCommand(p, command("start"));
  value = await clockCommand(
    p,
    command("pause", value.entry!.id, value.entry!.version),
  );
  const pauseAt = new Date(value.entry!.breakStartedAt!).getTime();
  await new Promise((resolve) => setTimeout(resolve, 25));
  value = await clockCommand(
    p,
    command("finish", value.entry!.id, value.entry!.version),
  );
  expect(value.entry!.breakStartedAt).toBeNull();
  expect(value.entry!.breakMilliseconds).toBe(
    new Date(value.entry!.endAt!).getTime() - pauseAt,
  );
});
it("restricts dispatchers, rejects inactive drivers, and enforces one active clock at database level", async () => {
  expect(allowed({ ...p, role: "DISPATCHER" }, "work-times", "write")).toBe(
    false,
  );
  await expect(
    mutateOperations(
      { ...p, role: "DISPATCHER" },
      "work-times",
      "create",
      undefined,
      {},
    ),
  ).rejects.toMatchObject({ status: 403 });
  await database().driverProfile.update({
    where: { id: p.driverId! },
    data: { status: "INACTIVE" },
  });
  await expect(clockSnapshot(p)).rejects.toMatchObject({ status: 403 });
  await database().driverProfile.update({
    where: { id: p.driverId! },
    data: { status: "ACTIVE" },
  });
  const state = await clockCommand(p, command("start"));
  await expect(
    engine.query(
      `INSERT INTO "WorkTimeEntry" (id,"organizationId","driverId","startAt","updatedAt","clockState") VALUES ($1,$2,$3,NOW(),NOW(),'RUNNING')`,
      [randomUUID(), p.organizationId, p.driverId],
    ),
  ).rejects.toThrow(/one_active_clock_per_driver/);
  await clockCommand(
    p,
    command("finish", state.entry!.id, state.entry!.version),
  );
});
it("cannot read or finish another driver's actual record in the same organisation", async () => {
  const db = database();
  await db.driverProfile.create({
    data: {
      id: "peer-clock-driver",
      organizationId: p.organizationId,
      firstName: "Private",
      lastName: "Peer",
      email: "peer-clock@example.test",
    },
  });
  const peer = await db.workTimeEntry.create({
    data: {
      driverId: "peer-clock-driver",
      organizationId: p.organizationId,
      startAt: new Date("2021-01-01T08:00:00Z"),
      endAt: new Date("2021-01-01T16:00:00Z"),
      status: "SUBMITTED",
    },
  });
  await expect(
    clockCommand(p, command("finish", peer.id, peer.version)),
  ).rejects.toMatchObject({ status: 404 });
  const own = await listModule(p, "work-times", new URLSearchParams());
  expect(JSON.stringify(own)).not.toContain(peer.id);
  expect(JSON.stringify(own)).not.toContain("Private Peer");
});
