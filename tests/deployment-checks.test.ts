import { it, expect } from "vitest";
import {
  configurationChecks,
  migrationChecks,
} from "../scripts/deployment-checks";
const env = {
  DATABASE_URL: "postgresql://app:private@localhost/fleet",
  BETTER_AUTH_URL: "https://fleet.example.test",
  BETTER_AUTH_SECRET: "a-random-looking-test-only-secret-long-enough",
};
it("accepts source deployment configuration and supported Node", () => {
  expect(
    configurationChecks(env, "24.19.0").every((r) => r.status === "PASS"),
  ).toBe(true);
});
it("blocks unsupported Node and example configuration", () => {
  const rows = configurationChecks(
    {
      DATABASE_URL:
        "postgresql://app:replace-with-private-password@localhost/fleet",
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "replace-with-at-least-32-random-bytes",
    },
    "22.0.0",
  );
  expect(rows.filter((r) => r.status === "BLOCKED")).toHaveLength(4);
});
it("rejects noncanonical origins, manual delivery and leftover provisioning", () => {
  for (const origin of [
    "https://fleet.test/path",
    "https://user:password@fleet.test",
    "https://fleet.test/?token=secret",
  ])
    expect(
      configurationChecks({ ...env, BETTER_AUTH_URL: origin })[2].status,
    ).toBe("BLOCKED");
  expect(
    configurationChecks({
      ...env,
      INVITATION_DELIVERY: "manual",
      PROVISION_PASSWORD: "secret",
    }).filter((r) => r.status === "BLOCKED"),
  ).toHaveLength(2);
});
it("does not echo supplied credentials in configuration results", () => {
  const secret = "credential-that-must-never-be-printed";
  expect(
    JSON.stringify(
      configurationChecks({
        ...env,
        BETTER_AUTH_SECRET: secret,
        DATABASE_URL: `postgresql://user:${secret}@private.test/fleet`,
      }),
    ),
  ).not.toContain(secret);
});
it("requires successful matching migration history", () => {
  expect(
    migrationChecks(
      [{ name: "initial", checksum: "abc" }],
      [
        {
          migration_name: "initial",
          checksum: "abc",
          finished_at: new Date(),
          rolled_back_at: null,
        },
      ],
    )[0].status,
  ).toBe("PASS");
});
it("blocks pending, incomplete and modified migrations", () => {
  const local = [{ name: "initial", checksum: "abc" }];
  expect(migrationChecks(local, [])[0].status).toBe("BLOCKED");
  expect(
    migrationChecks(local, [
      {
        migration_name: "initial",
        checksum: "abc",
        finished_at: null,
        rolled_back_at: null,
      },
    ]).some((r) => r.name === "migration_incomplete"),
  ).toBe(true);
  expect(
    migrationChecks(local, [
      {
        migration_name: "initial",
        checksum: "changed",
        finished_at: new Date(),
        rolled_back_at: null,
      },
    ])[0].name,
  ).toBe("migration_checksum");
});
it("blocks newer database history and ignores rolled-back attempts", () => {
  const good = {
    migration_name: "initial",
    checksum: "abc",
    finished_at: new Date(),
    rolled_back_at: null,
  };
  expect(
    migrationChecks(
      [{ name: "initial", checksum: "abc" }],
      [good, { ...good, migration_name: "future" }],
    ).some((r) => r.name === "migration_unknown"),
  ).toBe(true);
  expect(
    migrationChecks(
      [{ name: "initial", checksum: "abc" }],
      [good, { ...good, finished_at: null, rolled_back_at: new Date() }],
    )[0].status,
  ).toBe("PASS");
});
it("blocks missing source files and duplicate successful history", () => {
  expect(migrationChecks([], [])[0].status).toBe("BLOCKED");
  const row = {
    migration_name: "initial",
    checksum: "abc",
    finished_at: new Date(),
    rolled_back_at: null,
  };
  expect(
    migrationChecks([{ name: "initial", checksum: "abc" }], [row, row])[0]
      .status,
  ).toBe("BLOCKED");
});

it("CLI fails closed without valid environment and emits a credential-free report", async () => {
  const { spawnSync } = await import("node:child_process");
  const privateValue = "do-not-print-this-auth-secret-123456789";
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/deploy-check.ts", "--probe"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        BETTER_AUTH_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: privateValue,
        DATABASE_URL: "invalid",
      },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  expect(run.status).toBe(1);
  const report = JSON.parse(run.stdout);
  expect(report.status).toBe("BLOCKED");
  expect(
    report.checks.some(
      (r: { name: string; status: string }) =>
        r.name === "database_connection" && r.status === "BLOCKED",
    ),
  ).toBe(true);
  expect(
    report.checks.some(
      (r: { name: string; status: string }) =>
        r.name === "http_probe" && r.status === "BLOCKED",
    ),
  ).toBe(true);
  expect(run.stdout + run.stderr).not.toContain(privateValue);
}, 30000);
