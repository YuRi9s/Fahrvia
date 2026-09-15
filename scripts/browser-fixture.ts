/** Disposable browser fixture only; always overrides DB/mail settings; never seeds an external DB. */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { hashPassword } from "better-auth/crypto";
import { migrationSql } from "./migrations";
import { database } from "../src/server/db";

if (
  process.env.E2E_LOCAL_FIXTURE !== "1" ||
  !process.env.E2E_TEST_PASSWORD ||
  process.env.NODE_ENV === "production"
)
  throw new Error("Use the dedicated local Playwright configuration.");
const engine = await PGlite.create();
for (const sql of await migrationSql()) await engine.exec(sql);
const server = new PGLiteSocketServer({
  db: engine,
  port: 5499,
  maxConnections: 20,
  host: "127.0.0.1",
});
await server.start();
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5499/postgres",
});
const db = database();
await db.organization.create({
  data: { id: "browser-org", name: "Browser Test Fleet" },
});
const password = await hashPassword(process.env.E2E_TEST_PASSWORD);
for (const role of ["ADMIN", "DISPATCHER", "DRIVER"] as const) {
  const id = role.toLowerCase();
  await db.user.create({
    data: {
      id,
      name: `Test ${role}`,
      email: `${id}@browser.example.test`,
      emailVerified: true,
    },
  });
  await db.account.create({
    data: { id, userId: id, accountId: id, providerId: "credential", password },
  });
  const member = await db.membership.create({
    data: { userId: id, organizationId: "browser-org", role },
  });
  if (role === "DRIVER")
    await db.driverProfile.create({
      data: {
        id: "browser-driver",
        organizationId: "browser-org",
        membershipId: member.id,
        firstName: "Test",
        lastName: "Driver",
        email: "driver@browser.example.test",
      },
    });
}
await db.$disconnect();
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      AUTH_EMAIL_WEBHOOK_URL: "",
      AUTH_EMAIL_WEBHOOK_TOKEN: "",
      INVITATION_DELIVERY: "manual",
    },
  },
);
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  app.kill("SIGTERM");
  await server.stop();
  await engine.close();
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
app.on("exit", (code) => void stop(code ?? 1));
