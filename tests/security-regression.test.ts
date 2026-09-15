import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import { hashPassword, symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { auth } from "../src/server/auth";
import { database } from "../src/server/db";
import { download } from "../src/features/uploads/service";
import { mutateOperations } from "../src/features/operations/service";
import { listModule } from "../src/server/queries";
import type { Principal } from "../src/server/policy";
let engine: PGlite, server: PGLiteSocketServer;
const admin: Principal = {
  userId: "security-admin",
  organizationId: "security-org",
  role: "ADMIN",
  driverId: null,
  name: "Security Admin",
  email: "security@example.test",
  organizationName: "Security Test",
};
const driver: Principal = {
  ...admin,
  userId: "security-driver",
  driverId: "security-profile",
  role: "DRIVER",
};
const password = "Security-only-test-password-782";
async function request(
  path: string,
  body: unknown,
  cookies = new Map<string, string>(),
) {
  const response = await auth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: JSON.stringify(body),
    }),
  );
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const split = pair.indexOf("=");
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  return { response, body: await response.json(), cookies };
}
beforeAll(async () => {
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET =
    "security-test-secret-74293749283749283749283749283749";
  engine = await PGlite.create();
  for (const dir of (await readdir("prisma/migrations"))
    .filter((x) => x.startsWith("2026"))
    .sort())
    await engine.exec(
      await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"),
    );
  server = new PGLiteSocketServer({
    db: engine,
    port: 5441,
    host: "127.0.0.1",
  });
  await server.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5441/postgres";
  const db = database();
  await db.organization.create({
    data: { id: admin.organizationId, name: admin.organizationName },
  });
  await db.user.create({
    data: {
      id: admin.userId,
      email: admin.email,
      name: admin.name,
      emailVerified: true,
      accounts: {
        create: {
          id: "security-account",
          accountId: admin.userId,
          providerId: "credential",
          password: await hashPassword(password),
        },
      },
    },
  });
  await db.membership.create({
    data: {
      userId: admin.userId,
      organizationId: admin.organizationId,
      role: "ADMIN",
    },
  });
  await db.driverProfile.create({
    data: {
      id: driver.driverId!,
      organizationId: admin.organizationId,
      email: "driver@example.test",
      firstName: "Test",
      lastName: "Driver",
    },
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  if (server) await server.stop();
  if (engine) await engine.close();
});
it("rejects stale work-time approval after a correction", async () => {
  const data = {
    driverId: driver.driverId,
    startAt: "2026-09-01T08:00:00Z",
    endAt: "2026-09-01T16:00:00Z",
    breakMinutes: 30,
  };
  const row = await mutateOperations(
    admin,
    "work-times",
    "create",
    undefined,
    data,
  );
  await mutateOperations(admin, "work-times", "update", row.id, {
    ...data,
    endAt: "2026-09-01T17:00:00Z",
    reason: "Corrected end time",
  });
  await expect(
    mutateOperations(admin, "work-times", "approve", row.id, {
      expectedVersion: 1,
    }),
  ).rejects.toThrow("geändert");
  await mutateOperations(admin, "work-times", "approve", row.id, {
    expectedVersion: 2,
  });
  expect(
    (
      await database().workTimeEntry.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).version,
  ).toBe(3);
});
it("does not expose audit events to dispatchers", async () => {
  const dashboard = await listModule(
    { ...admin, role: "DISPATCHER" },
    "dashboard",
  );
  expect("recent" in dashboard && dashboard.recent).toEqual([]);
});
it("denies unlinked and private vehicle files even to the current driver", async () => {
  const db = database();
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: admin.organizationId,
      plate: "SEC 1",
      vin: "SECURITYVIN1",
      brand: "VW",
      model: "Caddy",
      year: 2024,
      ownership: "OWNED",
      inFleet: new Date(),
    },
  });
  await db.vehicleAssignment.create({
    data: {
      organizationId: admin.organizationId,
      driverId: driver.driverId!,
      vehicleId: vehicle.id,
      createdBy: admin.userId,
    },
  });
  const object = await db.storedObject.create({
    data: {
      organizationId: admin.organizationId,
      key: "never-read",
      filename: "private.pdf",
      mime: "application/pdf",
      size: 100,
      status: "READY",
      createdBy: admin.userId,
      vehicleId: vehicle.id,
    },
  });
  await expect(download(driver, object.id)).rejects.toThrow("nicht gefunden");
  await expect(download(admin, object.id)).rejects.toThrow("nicht gefunden");
  const doc = await db.document.create({
    data: {
      organizationId: admin.organizationId,
      title: "Private secret",
      vehicleId: vehicle.id,
      objectId: object.id,
    },
  });
  await expect(download(driver, object.id)).rejects.toThrow("nicht gefunden");
  expect(
    JSON.stringify(
      await listModule(driver, "documents", new URLSearchParams("q=Private")),
    ),
  ).not.toContain(doc.id);
  await db.document.update({
    where: { id: doc.id },
    data: { driverVisible: true },
  });
  expect(
    JSON.stringify(
      await listModule(driver, "documents", new URLSearchParams("q=Private")),
    ),
  ).toContain(doc.id);
  await db.document.update({
    where: { id: doc.id },
    data: { archivedAt: new Date() },
  });
  await expect(download(driver, object.id)).rejects.toThrow("nicht gefunden");
});
it("enrolls MFA using the installed auth handler and revokes another password-only session", async () => {
  const a = await request("/sign-in/email", { email: admin.email, password });
  const b = await request("/sign-in/email", { email: admin.email, password });
  expect(a.response.status).toBe(200);
  expect(b.response.status).toBe(200);
  const before = await database().session.findMany({
    where: { userId: admin.userId },
  });
  expect(before).toHaveLength(2);
  expect(before.every((s) => !s.mfaVerified)).toBe(true);
  const enable = await request("/two-factor/enable", { password }, a.cookies);
  expect(enable.response.status, JSON.stringify(enable.body)).toBe(200);
  const factor = await database().twoFactor.findUniqueOrThrow({
    where: { userId: admin.userId },
  });
  expect(factor.verified).toBe(false);
  const secret = await symmetricDecrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: factor.secret,
  });
  const verify = await request(
    "/two-factor/verify-totp",
    { code: await createOTP(secret).totp() },
    a.cookies,
  );
  expect(verify.response.status, JSON.stringify(verify.body)).toBe(200);
  const sessions = await database().session.findMany({
    where: { userId: admin.userId },
  });
  expect(sessions).toHaveLength(1);
  expect(sessions[0].mfaVerified).toBe(true);
  expect(before.map((s) => s.id)).not.toContain(sessions[0].id);
  const oldHeaders = new Headers({
    cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  });
  expect(await auth().api.getSession({ headers: oldHeaders })).toBeNull();
  const login = await request("/sign-in/email", {
    email: admin.email,
    password,
  });
  expect(login.response.status).toBe(200);
  expect(login.body.twoFactorRedirect).toBe(true);
  const wrong = await request(
    "/two-factor/verify-totp",
    { code: "000000" },
    login.cookies,
  );
  expect(wrong.response.status).toBe(401);
  const recovery = await request(
    "/two-factor/verify-backup-code",
    { code: enable.body.backupCodes[0] },
    login.cookies,
  );
  expect(recovery.response.status, JSON.stringify(recovery.body)).toBe(200);
  const recovered = await database().session.findMany({
    where: { userId: admin.userId },
  });
  expect(recovered.every((s) => s.mfaVerified)).toBe(true);
});
