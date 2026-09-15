import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { auth, principalFromHeaders } from "../src/server/auth";
import type { Principal } from "../src/server/policy";
import { listAccounts, changeAccount } from "../src/features/accounts/service";
import {
  createInvitation,
  previewInvitation,
} from "../src/features/invitations/service";
import { POST } from "../src/app/api/v1/accounts/route";
import { mutateFleet } from "../src/features/fleet/service";
import { hashPassword } from "better-auth/crypto";
let engine: PGlite, socket: PGLiteSocketServer;
const root: Principal = {
  userId: "root",
  organizationId: "org",
  role: "SUPER_ADMIN",
  driverId: null,
  name: "Root",
  email: "root@example.test",
  organizationName: "Fleet",
};
const admin: Principal = { ...root, userId: "admin", role: "ADMIN" };
async function member(id: string, role = "DISPATCHER", organizationId = "org") {
  await database().user.create({
    data: { id, name: id, email: `${id}@example.test` },
  });
  return database().membership.create({
    data: { id, userId: id, organizationId, role },
  });
}
async function change(
  id: string,
  role: string,
  active = true,
  actor = root,
  version?: number,
) {
  const row = await database().membership.findUniqueOrThrow({ where: { id } });
  return changeAccount(actor, {
    id,
    role,
    active,
    version: version ?? row.version,
    reason: "Test access review",
  });
  const events = await database().securityEvent.findMany({
    where: { resourceId: row.id, organizationId: root.organizationId },
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "account-access-changed",
    actorId: root.userId,
  });
  expect(events[0].details).toMatchObject({
    before: { role: "DISPATCHER" },
    after: { role: "ADMIN" },
  });
}
beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET =
    "account-test-secret-098234098234098234098234098234";
  process.env.INVITATION_DELIVERY = "manual";
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5444,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5444/postgres";
  await database().organization.createMany({
    data: [
      { id: "org", name: "Fleet" },
      { id: "foreign", name: "Foreign" },
    ],
  });
  await member("root", "SUPER_ADMIN");
  await member("admin", "ADMIN");
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
});
it("lists only tenant accounts, paginates and searches without credential data", async () => {
  await member("outside", "ADMIN", "foreign");
  for (let i = 0; i < 27; i++) await member(`staff-${i}`);
  const first = await listAccounts(root);
  expect(first.items).toHaveLength(25);
  expect(first.total).toBe(29);
  expect(JSON.stringify(first)).not.toMatch(/outside|password|token/);
  expect(
    (await listAccounts(root, new URLSearchParams({ q: "staff-26" }))).total,
  ).toBe(1);
  expect(
    (await listAccounts(root, new URLSearchParams({ page: "2" }))).items,
  ).toHaveLength(4);
  await expect(listAccounts({ ...root, role: "DISPATCHER" })).rejects.toThrow();
  await expect(
    listAccounts({ ...root, organizationId: "foreign" }),
  ).rejects.toThrow();
});
it("blocks self changes, super-admin changes, escalation and foreign accounts", async () => {
  await expect(change("root", "ADMIN")).rejects.toThrow();
  await expect(change("admin", "DISPATCHER", true, admin)).rejects.toThrow();
  await expect(change("staff-0", "ADMIN", true, admin)).rejects.toThrow();
  await expect(change("staff-0", "SUPER_ADMIN")).rejects.toThrow();
  await expect(change("outside", "DISPATCHER")).rejects.toThrow();
  await expect(
    change("staff-0", "DISPATCHER", false, { ...root, role: "DISPATCHER" }),
  ).rejects.toThrow();
});
it("rejects stale edits and records before/after and reason atomically", async () => {
  const row = await member("versioned");
  await change(row.id, "ADMIN");
  await expect(
    change(row.id, "DISPATCHER", true, root, row.version),
  ).rejects.toThrow("neu laden");
  const log = await database().auditLog.findFirstOrThrow({
    where: { resourceId: row.id, resourceType: "membership" },
  });
  expect(log.details).toMatchObject({
    before: { role: "DISPATCHER", active: true },
    after: { role: "ADMIN", active: true },
    reason: "Test access review",
  });
});
it("revokes actual signed-in sessions and restores access only with a fresh sign-in", async () => {
  await member("session-user");
  const password = "Session-revocation-test-123";
  await database().account.create({
    data: {
      id: "session-credential",
      userId: "session-user",
      accountId: "session-user",
      providerId: "credential",
      password: await hashPassword(password),
    },
  });
  async function login() {
    // Isolate repeated identity assertions from the unrelated sign-in throttle in this disposable DB.
    await database().rateLimit.deleteMany();
    const response = await auth().handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "session-user@example.test", password }),
      }),
    );
    expect(response.status).toBe(200);
    return new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
  }
  const headers = await login();
  expect((await principalFromHeaders(headers)).role).toBe("DISPATCHER");
  await change("session-user", "ADMIN");
  await expect(principalFromHeaders(headers)).rejects.toThrow();
  const fresh = await login();
  expect((await principalFromHeaders(fresh)).role).toBe("ADMIN");
  await change("session-user", "ADMIN", false);
  await expect(principalFromHeaders(fresh)).rejects.toThrow();
  await expect(principalFromHeaders(await login())).rejects.toThrow();
  await change("session-user", "ADMIN", true);
  expect((await principalFromHeaders(await login())).role).toBe("ADMIN");
});
it("does not revive invitations when the issuer's account is restored", async () => {
  await member("issuer", "ADMIN");
  const invitation = await createInvitation(
    { ...admin, userId: "issuer" },
    { role: "DISPATCHER", name: "Invite", email: "pending@example.test" },
  );
  const token = invitation.localLink!.split("#")[1];
  await change("issuer", "ADMIN", false);
  await change("issuer", "ADMIN", true);
  await expect(previewInvitation(token)).rejects.toThrow();
});
it("requires an active linked driver and preserves that link through role changes", async () => {
  await member("driver", "DRIVER");
  await database().driverProfile.create({
    data: {
      id: "driver-profile",
      organizationId: "org",
      membershipId: "driver",
      firstName: "Driver",
      lastName: "Test",
      email: "driver@example.test",
    },
  });
  await change("driver", "DISPATCHER");
  await change("driver", "DRIVER");
  expect(
    (
      await database().driverProfile.findUniqueOrThrow({
        where: { id: "driver-profile" },
      })
    ).membershipId,
  ).toBe("driver");
  await expect(change("staff-1", "DRIVER")).rejects.toThrow("Fahrerprofil");
  await change("driver", "DRIVER", false);
  await database().driverProfile.update({
    where: { id: "driver-profile" },
    data: { status: "INACTIVE" },
  });
  await expect(change("driver", "DRIVER", true)).rejects.toThrow(
    "Fahrerprofil",
  );
  expect(
    (
      await database().driverProfile.findUniqueOrThrow({
        where: { id: "driver-profile" },
      })
    ).status,
  ).toBe("INACTIVE");
});
it("rejects a second active organization and stale actor privileges", async () => {
  await member("multi");
  await change("multi", "DISPATCHER", false);
  await database().membership.create({
    data: { userId: "multi", organizationId: "foreign", role: "DISPATCHER" },
  });
  await expect(change("multi", "DISPATCHER", true)).rejects.toThrow(
    "Organisation",
  );
  await member("former-admin", "ADMIN");
  const stale = { ...admin, userId: "former-admin" };
  await change("former-admin", "DISPATCHER");
  await expect(change("staff-2", "DISPATCHER", false, stale)).rejects.toThrow();
});
it("rejects cross-origin HTTP mutations and malformed input", async () => {
  const response = await POST(
    new Request("http://localhost:3000/api/v1/accounts", {
      method: "POST",
      headers: {
        origin: "https://foreign.example.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toContain("no-store");
  await expect(
    changeAccount(root, {
      id: "staff-0",
      role: "ADMIN",
      active: true,
      version: 1,
      reason: "",
    }),
  ).rejects.toThrow();
});

it("archiving a former driver cannot revoke a promoted administrator", async () => {
  await member("promoted", "DRIVER");
  await database().driverProfile.create({
    data: {
      id: "promoted-profile",
      organizationId: "org",
      membershipId: "promoted",
      firstName: "Former",
      lastName: "Driver",
      email: "promoted@example.test",
    },
  });
  await change("promoted", "ADMIN");
  await mutateFleet(root, "drivers", "archive", "promoted-profile", {});
  const membership = await database().membership.findUniqueOrThrow({
    where: { id: "promoted" },
  });
  expect(membership).toMatchObject({ role: "ADMIN", active: true });
});
it("allows one versioned change and filters disabled accounts", async () => {
  const row = await member("contested");
  const attempts = await Promise.allSettled([
    change(row.id, "DISPATCHER", false, root, row.version),
    change(row.id, "ADMIN", true, root, row.version),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await database().auditLog.count({
      where: { resourceId: row.id, action: "account-change" },
    }),
  ).toBe(1);
  const result = await listAccounts(
    root,
    new URLSearchParams({ status: "disabled" }),
  );
  expect(result.total).toBeGreaterThan(0);
  expect(result.items.every((row) => !row.active)).toBe(true);
});
it("upgrades existing memberships without changing their state", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const migrationIndex = migrations.findIndex((sql) =>
      sql.includes('ALTER TABLE "Membership" ADD COLUMN "version"'),
    );
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    for (const sql of migrations.slice(0, migrationIndex))
      await legacy.exec(sql);
    await legacy.exec(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('old-org','Existing',NOW());
      INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('old-user','Existing','old@example.test',NOW());
      INSERT INTO "Membership" (id,"organizationId","userId",role,active) VALUES ('old-member','old-org','old-user','ADMIN',false);`);
    await legacy.exec(migrations[migrationIndex]);
    expect(
      (await legacy.query('SELECT id,role,active,version FROM "Membership"'))
        .rows,
    ).toEqual([{ id: "old-member", role: "ADMIN", active: false, version: 1 }]);
  } finally {
    await legacy.close();
  }
});
