import { URL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nodeSupported,
  parseArgs,
  migrationPlan,
  safeEnvironment,
  validateConfig,
  connectionUrl,
} from "../../scripts/local/core.mjs";
test("only supported Node 24 releases", () => {
  for (const v of ["24.19.0", "24.20.0"]) assert.equal(nodeSupported(v), true);
  for (const v of ["24.18.9", "25.0.0", "22.0.0", "24.19.0-rc.1"])
    assert.equal(nodeSupported(v), false);
});
test("restore requires a path; destructive consent is explicit", () => {
  assert.throws(() => parseArgs(["restore"]));
  assert.throws(() => parseArgs(["bootstrap", "--reset"]));
  assert.throws(() => parseArgs(["bootstrap", "--restore"]));
  assert.deepEqual(parseArgs(["restore", "./backups/a.dump", "--yes"]), {
    command: "restore",
    restore: "./backups/a.dump",
    yes: true,
    port: undefined,
  });
});
const local = [
  { name: "a", checksum: "1" },
  { name: "b", checksum: "2" },
];
const applied = (name, checksum) => ({
  migration_name: name,
  checksum,
  finished_at: "today",
  rolled_back_at: null,
});
test("pending is a strict suffix, never a mismatch or failed migration", () => {
  assert.deepEqual(migrationPlan(local, []), ["a", "b"]);
  assert.deepEqual(migrationPlan(local, [applied("a", "1")]), ["b"]);
  assert.deepEqual(
    migrationPlan(
      local,
      local.map((m) => applied(m.name, m.checksum)),
    ),
    [],
  );
  for (const rows of [
    [applied("a", "wrong")],
    [applied("z", "1")],
    [applied("b", "2")],
    [applied("a", "1"), applied("a", "1")],
    [{ ...applied("a", "1"), finished_at: null }],
  ])
    assert.throws(() => migrationPlan(local, rows));
  assert.deepEqual(
    migrationPlan(local, [
      { ...applied("a", "1"), finished_at: null, rolled_back_at: "done" },
    ]),
    ["a", "b"],
  );
});
test("child environment removes inherited database/admin/seed overrides", () => {
  const env = safeEnvironment({
    PATH: "/bin",
    DATABASE_URL: "secret",
    PGPASSWORD: "secret",
    SEED_ADMIN_PASSWORD: "secret",
    LOCAL_DB_PORT: "9999",
    NODE_OPTIONS: "evil",
    COMPOSE_FILE: "evil",
    BETTER_AUTH_SECRET: "secret",
  });
  assert.equal(env.PATH, "/bin");
  for (const k of [
    "DATABASE_URL",
    "PGPASSWORD",
    "SEED_ADMIN_PASSWORD",
    "LOCAL_DB_PORT",
    "NODE_OPTIONS",
    "COMPOSE_FILE",
    "BETTER_AUTH_SECRET",
  ])
    assert.equal(env[k], undefined);
});
test("configuration and URLs cannot escape the managed loopback database", () => {
  const c = {
    version: 1,
    id: "12345678-1234-4234-8234-123456789012",
    project: "fahriva_123456781234",
    port: 55432,
    database: "fahriva",
    migratorPassword: "a".repeat(64),
    runtimePassword: "b".repeat(64),
  };
  assert.doesNotThrow(() => validateConfig(c));
  assert.equal(new URL(connectionUrl(c, "runtime")).hostname, "127.0.0.1");
  for (const patch of [
    { port: 5432.5 },
    { database: "postgres" },
    { project: "../oops" },
    { runtimePassword: "default" },
  ])
    assert.throws(() => validateConfig({ ...c, ...patch }));
});
