import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import { auth, principalFromHeaders } from "../src/server/auth";
import type { Principal } from "../src/server/policy";
import {
  createInvitation,
  changeInvitation,
  listInvitations,
  previewInvitation,
  acceptInvitation,
  publicInvitationLimit,
} from "../src/features/invitations/service";
import { invitationTransport } from "../src/features/invitations/transport";
import { POST as publicRoute } from "../src/app/api/invitations/route";
let engine: PGlite, socket: PGLiteSocketServer, webhook: Server;
const password = "Invitation-test-password-982";
const admin: Principal = {
  userId: "invite-admin",
  organizationId: "invite-org",
  role: "ADMIN",
  driverId: null,
  name: "Invite Admin",
  email: "invite-admin@example.test",
  organizationName: "Invite Test",
};
const superAdmin: Principal = {
  ...admin,
  userId: "invite-super",
  role: "SUPER_ADMIN",
};
function token(result: { invitation: { id: string }; localLink?: string }) {
  expect(result.localLink).toBeTruthy();
  return result.localLink!.split("#")[1];
}
async function invite(email: string) {
  return createInvitation(admin, {
    email,
    name: "Invite Person",
    role: "DISPATCHER",
  });
}
async function age(id: string) {
  await database().invitation.update({
    where: { id },
    data: { lastSentAt: new Date(Date.now() - 61000) },
  });
}
beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET =
    "invitation-test-secret-098234098234098234098234098234";
  process.env.INVITATION_DELIVERY = "manual";
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  socket = new PGLiteSocketServer({
    db: engine,
    port: 5443,
    host: "127.0.0.1",
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5443/postgres";
  const db = database();
  await db.organization.createMany({
    data: [
      { id: admin.organizationId, name: admin.organizationName },
      { id: "invite-foreign-org", name: "Foreign" },
    ],
  });
  await db.user.createMany({
    data: [
      { id: admin.userId, name: admin.name, email: admin.email },
      {
        id: superAdmin.userId,
        name: "Super",
        email: "invite-super@example.test",
      },
    ],
  });
  await db.membership.createMany({
    data: [admin, superAdmin].map((p) => ({
      userId: p.userId,
      organizationId: p.organizationId,
      role: p.role,
    })),
  });
}, 30000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await database().$disconnect();
  await socket?.stop();
  await engine?.close();
  if (webhook)
    await new Promise<void>((resolve) => webhook.close(() => resolve()));
});
it("creates hashed, scoped invitations without exposing tokens in lists or audits", async () => {
  const result = await invite("scope@example.test");
  const raw = token(result);
  const row = await database().invitation.findUniqueOrThrow({
    where: { id: result.invitation.id },
  });
  expect(row.tokenHash).not.toBe(raw);
  expect(row.tokenHash).toHaveLength(64);
  expect(JSON.stringify(await listInvitations(admin))).not.toContain(
    row.tokenHash,
  );
  expect(
    JSON.stringify(
      await listInvitations({ ...admin, organizationId: "invite-foreign-org" }),
    ),
  ).not.toContain(row.email);
  expect(JSON.stringify(await database().auditLog.findMany())).not.toContain(
    raw,
  );
  await expect(
    createInvitation(
      { ...admin, role: "DISPATCHER" },
      { role: "ADMIN", email: "evil@example.test", name: "Bad" },
    ),
  ).rejects.toThrow();
  await expect(
    createInvitation(admin, {
      role: "ADMIN",
      email: "admin2@example.test",
      name: "Admin",
    }),
  ).rejects.toThrow();
  await expect(
    createInvitation(superAdmin, {
      role: "SUPER_ADMIN",
      email: "root@example.test",
      name: "Root",
    }),
  ).rejects.toThrow();
});
it("creates a credential account exactly once and signs in with Better Auth", async () => {
  const result = await invite("login@example.test");
  const raw = token(result);
  await acceptInvitation({ token: raw, password });
  await expect(acceptInvitation({ token: raw, password })).rejects.toThrow();
  const user = await database().user.findUniqueOrThrow({
    where: { email: "login@example.test" },
  });
  expect(user.emailVerified).toBe(false);
  const account = await database().account.findFirstOrThrow({
    where: { userId: user.id },
  });
  expect(account.password).not.toBe(password);
  const response = await auth().handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: user.email, password }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect((await principalFromHeaders(new Headers({ cookie }))).role).toBe(
    "DISPATCHER",
  );
  await expect(invite("login@example.test")).rejects.toThrow(
    "bereits ein Konto",
  );
});
it("resending rotates the link and revocation invalidates the new link", async () => {
  const first = await invite("rotate@example.test");
  await expect(
    changeInvitation(admin, first.invitation.id, "resend"),
  ).rejects.toThrow("Minute");
  await age(first.invitation.id);
  const second = await changeInvitation(admin, first.invitation.id, "resend");
  await expect(previewInvitation(token(first))).rejects.toThrow();
  expect((await previewInvitation(token(second))).email).toBe(
    "rotate@example.test",
  );
  await changeInvitation(admin, first.invitation.id, "revoke");
  await expect(
    acceptInvitation({ token: token(second), password }),
  ).rejects.toThrow();
  await expect(
    changeInvitation(admin, first.invitation.id, "resend"),
  ).rejects.toThrow("abgeschlossen");
});
it("expires links and renews an expired pending invitation", async () => {
  const result = await invite("expired@example.test");
  await database().invitation.update({
    where: { id: result.invitation.id },
    data: {
      expiresAt: new Date(Date.now() - 1000),
      lastSentAt: new Date(Date.now() - 61000),
    },
  });
  await expect(previewInvitation(token(result))).rejects.toThrow();
  const replacement = await changeInvitation(
    admin,
    result.invitation.id,
    "resend",
  );
  expect((await previewInvitation(token(replacement))).email).toBe(
    "expired@example.test",
  );
});
it("links an active existing driver without creating a duplicate profile", async () => {
  await database().driverProfile.create({
    data: {
      id: "invite-driver",
      organizationId: admin.organizationId,
      firstName: "Driver",
      lastName: "Test",
      email: "driver-invite@example.test",
    },
  });
  const result = await createInvitation(admin, {
    role: "DRIVER",
    driverId: "invite-driver",
    email: "tampered@example.test",
  });
  expect(result.invitation.email).toBe("driver-invite@example.test");
  await acceptInvitation({ token: token(result), password });
  const driver = await database().driverProfile.findUniqueOrThrow({
    where: { id: "invite-driver" },
    include: { membership: true },
  });
  expect(driver.membership?.role).toBe("DRIVER");
  expect(await database().driverProfile.count()).toBe(1);
});
it("rejects foreign drivers and rechecks driver eligibility at acceptance", async () => {
  await database().driverProfile.createMany({
    data: [
      {
        id: "foreign-invite-driver",
        organizationId: "invite-foreign-org",
        firstName: "Foreign",
        lastName: "Driver",
        email: "foreign@example.test",
      },
      {
        id: "inactive-invite-driver",
        organizationId: admin.organizationId,
        firstName: "Inactive",
        lastName: "Driver",
        email: "inactive@example.test",
      },
    ],
  });
  await expect(
    createInvitation(admin, {
      role: "DRIVER",
      driverId: "foreign-invite-driver",
    }),
  ).rejects.toThrow();
  const result = await createInvitation(admin, {
    role: "DRIVER",
    driverId: "inactive-invite-driver",
  });
  await database().driverProfile.update({
    where: { id: "inactive-invite-driver" },
    data: { status: "INACTIVE" },
  });
  await expect(
    acceptInvitation({ token: token(result), password }),
  ).rejects.toThrow("nicht mehr aktiv");
  expect(
    await database().user.findUnique({
      where: { email: "inactive@example.test" },
    }),
  ).toBeNull();
});
it("rejects changed issuer privileges and never accepts role input from the invitee", async () => {
  const result = await createInvitation(superAdmin, {
    role: "ADMIN",
    email: "new-admin@example.test",
    name: "New Admin",
  });
  await expect(
    acceptInvitation({ token: token(result), password, role: "SUPER_ADMIN" }),
  ).rejects.toThrow();
  await database().membership.update({
    where: {
      userId_organizationId: {
        userId: superAdmin.userId,
        organizationId: superAdmin.organizationId,
      },
    },
    data: { active: false },
  });
  await expect(
    acceptInvitation({ token: token(result), password }),
  ).rejects.toThrow();
});
it("handles conflicting account creation without resetting an existing password", async () => {
  const result = await invite("race@example.test");
  await database().user.create({
    data: { id: "race-existing", email: "race@example.test", name: "Existing" },
  });
  await expect(
    acceptInvitation({ token: token(result), password }),
  ).rejects.toThrow("besteht bereits");
  expect(
    await database().account.count({ where: { userId: "race-existing" } }),
  ).toBe(0);
});
it("hands off email to a local webhook, reports failure and does not expose production links", async () => {
  let payload: { to?: string; url?: string; template?: string } = {},
    fail = false;
  webhook = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    res.statusCode = fail ? 503 : 200;
    res.end();
  });
  await new Promise<void>((resolve) => webhook.listen(0, "127.0.0.1", resolve));
  const address = webhook.address();
  if (!address || typeof address === "string")
    throw new Error("No local webhook port");
  process.env.INVITATION_DELIVERY = "email";
  process.env.AUTH_EMAIL_WEBHOOK_URL = `http://127.0.0.1:${address.port}`;
  const result = await invite("mail@example.test");
  expect(result.localLink).toBeUndefined();
  expect(result.invitation.delivery).toBe("SENT");
  expect(payload.template).toBe("staff-invitation");
  expect(payload.to).toBe("mail@example.test");
  await acceptInvitation({ token: payload.url!.split("#")[1], password });
  expect(
    (
      await database().user.findUniqueOrThrow({
        where: { email: "mail@example.test" },
      })
    ).emailVerified,
  ).toBe(true);
  fail = true;
  const failure = await invite("failed-mail@example.test");
  expect(failure.invitation.delivery).toBe("FAILED");
  expect(failure.notice).toContain("nicht bestätigt");
  process.env.INVITATION_DELIVERY = "manual";
});
it("rejects production manual mode and malformed or cross-origin acceptance", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => invitationTransport()).toThrow();
  vi.unstubAllEnvs();
  const response = await publicRoute(
    new Request("http://localhost:3000/api/invitations", {
      method: "POST",
      headers: {
        origin: "https://other.example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "accept",
        token: "a".repeat(64),
        password,
      }),
    }),
  );
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toContain("no-store");
  await expect(previewInvitation("invalid")).rejects.toThrow();
});
it("rate limits repeated public token checks", async () => {
  for (let i = 0; i < 15; i++)
    await publicInvitationLimit("preview", "b".repeat(64));
  await expect(
    publicInvitationLimit("preview", "b".repeat(64)),
  ).rejects.toThrow("Zu viele");
});

it("allows only one acceptance when the same link is submitted twice", async () => {
  const result = await invite("simultaneous@example.test");
  const body = { token: token(result), password };
  const attempts = await Promise.allSettled([
    acceptInvitation(body),
    acceptInvitation(body),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await database().user.count({
      where: { email: "simultaneous@example.test" },
    }),
  ).toBe(1);
});

it("keeps invited administrators behind the existing production MFA gate", async () => {
  await database().membership.update({
    where: {
      userId_organizationId: {
        userId: superAdmin.userId,
        organizationId: superAdmin.organizationId,
      },
    },
    data: { active: true },
  });
  const result = await createInvitation(superAdmin, {
    name: "MFA Admin",
    email: "mfa-invited@example.test",
    role: "ADMIN",
  });
  expect(
    (await acceptInvitation({ token: token(result), password })).requiresMfa,
  ).toBe(true);
  const response = await auth().handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "mfa-invited@example.test", password }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  vi.stubEnv("NODE_ENV", "production");
  try {
    await expect(principalFromHeaders(new Headers({ cookie }))).rejects.toThrow(
      "Zwei-Faktor",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it("adds the invitation table without losing existing fleet records", async () => {
  const legacy = await PGlite.create();
  try {
    const migrations = await migrationSql();
    const invitationIndex = migrations.findIndex((sql) =>
      sql.includes('CREATE TABLE "Invitation"'),
    );
    expect(invitationIndex).toBeGreaterThanOrEqual(0);
    for (const sql of migrations.slice(0, invitationIndex))
      await legacy.exec(sql);
    await legacy.exec(`INSERT INTO "Organization" (id, name, "updatedAt") VALUES ('upgrade-org','Existing fleet',NOW());
      INSERT INTO "DriverProfile" (id,"organizationId","firstName","lastName",email,"updatedAt") VALUES ('upgrade-driver','upgrade-org','Existing','Driver','existing@example.test',NOW());`);
    await legacy.exec(migrations[invitationIndex]);
    expect((await legacy.query('SELECT id FROM "DriverProfile"')).rows).toEqual(
      [{ id: "upgrade-driver" }],
    );
    expect((await legacy.query('SELECT id FROM "Invitation"')).rows).toEqual(
      [],
    );
  } finally {
    await legacy.close();
  }
});
