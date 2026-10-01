import { parseEnv } from "node:util";
/** Opt-in REAL Docker acceptance. Only randomized, test-owned projects are deleted. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { run } from "../../scripts/local/process.mjs";
import { dockerPreflight } from "../../scripts/local/database.mjs";
import { connectionUrl } from "../../scripts/local/core.mjs";
const root = process.cwd(),
  npm = process.env.npm_execpath;
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "fahriva-db-acceptance-"));
  await cp(root, dir, {
    recursive: true,
    filter: (path) => {
      const rel = relative(root, path);
      return (
        !rel
          .split(/[\\/]/)
          .some((x) =>
            [
              "node_modules",
              ".next",
              ".local-db",
              "backups",
              ".git",
              "src/generated",
            ].includes(x),
          ) &&
        !/^\.env(?:\.|$)/.test(rel.replace(".env.example", "example")) &&
        !rel.startsWith("src/generated") &&
        !rel.startsWith("workers/score/lib")
      );
    },
  });
  return dir;
}
async function cli(dir, command, args = [], env = {}) {
  return run(process.execPath, [npm, "run", command, "--", ...args], {
    cwd: dir,
    env,
    timeout: 900000,
    label: `Acceptance ${command}`,
  });
}
async function config(dir) {
  return JSON.parse(await readFile(join(dir, ".local-db/config.json"), "utf8"));
}
async function query(dir, sql) {
  const c = await config(dir);
  const db = new Client({ connectionString: connectionUrl(c, "runtime") });
  await db.connect();
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.end();
  }
}
async function compose(dir, args) {
  const c = await config(dir);
  return run(
    "docker",
    [
      "compose",
      "-p",
      c.project,
      "--env-file",
      ".local-db/compose.env",
      "-f",
      "compose.yaml",
      ...args,
    ],
    { cwd: dir, label: "Acceptance Docker" },
  );
}
test(
  "real bootstrap, idempotency, native backup/restore, older-backup upgrade and migration failure",
  { timeout: 1800000 },
  async () => {
    await dockerPreflight(); // Missing Docker FAILS, never silently skips acceptance.
    assert(npm, "Run npm run test:local-db:docker");
    const dirs = [];
    try {
      const first = await fixture();
      dirs.push(first);
      const migrations = join(first, "prisma/migrations");
      const names = (await readdir(migrations, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      const last = names.at(-1);
      await rename(join(migrations, last), join(first, "withheld-migration"));
      const seed = {
        SEED_ADMIN_EMAIL: "acceptance@example.test",
        SEED_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
        SEED_ORGANIZATION: "Acceptance",
      };
      await cli(
        first,
        "local:bootstrap",
        ["--port", String(await freePort())],
        seed,
      );
      const users = await query(
        first,
        'SELECT id,email FROM "User" ORDER BY id',
      );
      assert.equal(users.length, 1);
      const creds = await readFile(
        join(first, ".local-db/config.json"),
        "utf8",
      );
      const env = await readFile(join(first, ".env"), "utf8");
      await cli(first, "local:bootstrap");
      assert.equal(
        await readFile(join(first, ".local-db/config.json"), "utf8"),
        creds,
      );
      assert.equal(await readFile(join(first, ".env"), "utf8"), env);
      assert.deepEqual(
        await query(first, 'SELECT id,email FROM "User" ORDER BY id'),
        users,
      );
      await compose(first, ["stop", "postgres"]);
      await cli(first, "local:bootstrap");
      await cli(first, "db:backup");
      const backupNames = (await readdir(join(first, "backups")))
        .filter((n) => n.endsWith(".dump"))
        .sort();
      const oldBackup = join(first, "backups", backupNames.at(-1));
      await rename(join(first, "withheld-migration"), join(migrations, last));
      await cli(first, "db:upgrade");
      await cli(first, "db:upgrade");
      await cli(first, "db:status");
      assert.equal(
        (
          await query(
            first,
            "SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL",
          )
        )[0].n,
        names.length,
      );
      const rights = (
        await query(
          first,
          "SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      )[0];
      assert(Object.values(rights).every((v) => v === false));
      await assert.rejects(
        query(first, "CREATE TABLE public.should_fail(id int)"),
      );
      await cli(first, "db:restore", [oldBackup, "--yes"]);
      assert.deepEqual(
        await query(first, 'SELECT id,email FROM "User" ORDER BY id'),
        users,
      );
      await cli(first, "db:status");
      const second = await fixture();
      dirs.push(second);
      await cli(
        second,
        "local:bootstrap",
        ["--port", String(await freePort()), "--restore", oldBackup, "--yes"],
        { RESTORE_AUTH_SECRET: parseEnv(env).BETTER_AUTH_SECRET },
      );
      assert.deepEqual(
        await query(second, 'SELECT id,email FROM "User" ORDER BY id'),
        users,
      );
      await cli(second, "db:status");
      const invalid = join(second, "invalid.dump");
      await writeFile(invalid, "invalid");
      await assert.rejects(cli(second, "db:restore", [invalid, "--yes"]));
      assert.deepEqual(
        await query(second, 'SELECT id,email FROM "User" ORDER BY id'),
        users,
      );
      // Loss of a previously initialized volume must never trigger a clean re-creation.
      await compose(second, ["down", "--volumes", "--remove-orphans"]);
      await assert.rejects(cli(second, "local:bootstrap"));
      const failed = join(
        first,
        "prisma/migrations/20990101_acceptance_failure",
      );
      await mkdir(failed);
      await writeFile(
        join(failed, "migration.sql"),
        "THIS IS INTENTIONALLY INVALID SQL;\n",
      );
      const before = (await readdir(join(first, "backups"))).length;
      await assert.rejects(cli(first, "db:upgrade"));
      assert((await readdir(join(first, "backups"))).length > before);
      assert.deepEqual(
        await query(first, 'SELECT id,email FROM "User" ORDER BY id'),
        users,
      );
      await assert.rejects(cli(first, "db:upgrade")); // unfinished migration remains blocked, never reset/resolved
    } finally {
      for (const dir of dirs) {
        try {
          await config(dir);
          await compose(dir, ["down", "--volumes", "--remove-orphans"]);
          await rm(dir, { recursive: true, force: true });
        } catch {
          console.error(
            `Acceptance cleanup incomplete: ${dir}. Inspect this test-owned project manually.`,
          );
        }
      }
    }
  },
);
