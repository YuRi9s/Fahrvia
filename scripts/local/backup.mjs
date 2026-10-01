import { parseEnv } from "node:util";
import { open, mkdir, lstat, readFile, rename, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  requireThat,
  roles,
  identifier as qi,
  literal as ql,
} from "./core.mjs";
import { atomicJson, exists } from "./config.mjs";
import {
  compose,
  adminSql,
  client,
  plan,
  migrate,
  grants,
  verifyRuntime,
  sources,
} from "./database.mjs";
import { ask } from "./prompt.mjs";
export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function archiveHeader(path) {
  const info = await lstat(path);
  requireThat(
    info.isFile() && !info.isSymbolicLink() && info.size > 5,
    "Backup must be a nonempty regular custom-format PostgreSQL file, not a symlink.",
  );
  const f = await open(path, "r");
  try {
    const b = Buffer.alloc(5);
    await f.read(b, 0, 5, 0);
    requireThat(
      b.toString() === "PGDMP",
      "Not a PostgreSQL custom-format archive. Use pg_dump --format=custom.",
    );
  } finally {
    await f.close();
  }
}
export async function validateArchive(c, path, requireFahriva = true) {
  await archiveHeader(path);
  const digest = await sha256(path);
  if (await exists(`${path}.json`)) {
    const meta = JSON.parse(await readFile(`${path}.json`, "utf8"));
    requireThat(
      meta.format === "fahriva-pgdump-v1" && meta.sha256 === digest,
      "Backup manifest/checksum mismatch. Do not restore this file.",
    );
  }
  const toc = await compose(
    c,
    ["exec", "-T", "postgres", "pg_restore", "--list"],
    {
      inputFile: path,
      allowEarlyInputClose: true,
      label: "PostgreSQL archive validation",
    },
  );
  requireThat(
    !requireFahriva ||
      (toc.includes("TABLE DATA public _prisma_migrations") &&
        toc.includes("TABLE DATA public Organization")),
    "Archive does not contain the expected Fahriva data and migration history.",
  );
  return digest;
}
export async function backup(c) {
  await mkdir("backups", { recursive: true, mode: 0o700 });
  const stat = await lstat("backups");
  requireThat(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "backups must be a real local directory.",
  );
  const name = `backups/fahriva-${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}.dump`;
  const partial = `${name}.partial`;
  const db = await client(c);
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await db.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    const tables = (
      await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows;
    const rowCounts = {};
    for (const { tablename } of tables)
      rowCounts[tablename] = (
        await db.query(
          `SELECT count(*)::text AS n FROM public.${qi(tablename)}`,
        )
      ).rows[0].n;
    await compose(
      c,
      [
        "exec",
        "-T",
        "-e",
        "PGPASSWORD",
        "postgres",
        "pg_dump",
        "--host=127.0.0.1",
        `--username=${roles.migrator}`,
        `--dbname=${c.database}`,
        "--format=custom",
        `--snapshot=${snapshot}`,
        "--no-acl",
      ],
      {
        env: { PGPASSWORD: c.migratorPassword },
        outputFile: partial,
        timeout: 600000,
        label: "PostgreSQL backup",
      },
    );
    await db.query("COMMIT");
    await validateArchive(c, partial, false);
    const completed = await open(partial, "r");
    try {
      await completed.sync();
    } finally {
      await completed.close();
    }
    await rename(partial, name);
    await atomicJson(`${name}.json`, {
      format: "fahriva-pgdump-v1",
      createdAt: new Date().toISOString(),
      postgres: "18.6",
      database: c.database,
      sha256: await sha256(name),
      sourceMigrations: await sources(),
      rowCounts,
      authSecretSha256: createHash("sha256")
        .update(parseEnv(await readFile(".env", "utf8")).BETTER_AUTH_SECRET)
        .digest("hex"),
    });
    console.log(`Backup verified: ${name}`);
    return name;
  } catch (error) {
    await unlink(partial).catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}
export async function restore(c, input, yes) {
  const path = resolve(input);
  const digest = await validateArchive(c, path);
  if (await exists(`${path}.json`)) {
    const meta = JSON.parse(await readFile(`${path}.json`, "utf8"));
    const authHash = createHash("sha256")
      .update(parseEnv(await readFile(".env", "utf8")).BETTER_AUTH_SECRET)
      .digest("hex");
    requireThat(
      meta.authSecretSha256 === authHash,
      "Backup authentication-secret fingerprint differs. Preserve the original BETTER_AUTH_SECRET to restore MFA. Target unchanged; see the transfer guide.",
    );
  }
  if (!yes)
    requireThat(
      (await ask(
        "Restore executes SQL from a trusted backup and replaces the local database. Stop Next.js and workers first. Type RESTORE fahriva to continue: ",
      )) === "RESTORE fahriva",
      "Restore cancelled; target unchanged.",
    );
  // Always restore under the limited schema owner, never under the bootstrap superuser.
  const suffix = randomBytes(6).toString("hex");
  const staging = `fahriva_restore_${suffix}`,
    retained = `fahriva_retained_${suffix}`;
  await adminSql(
    c,
    `CREATE DATABASE ${qi(staging)} OWNER ${qi(roles.migrator)} TEMPLATE template0;`,
  );
  console.log(
    `Validating restore in ${staging}; live target remains unchanged.`,
  );
  await adminSql(c, `DROP SCHEMA public;`, staging);
  try {
    await compose(
      c,
      [
        "exec",
        "-T",
        "-e",
        "PGPASSWORD",
        "postgres",
        "pg_restore",
        "--host=127.0.0.1",
        `--username=${roles.migrator}`,
        `--dbname=${staging}`,
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        "--single-transaction",
      ],
      {
        env: { PGPASSWORD: c.migratorPassword },
        inputFile: path,
        timeout: 600000,
        label: "Staged restore",
      },
    );
    requireThat(
      (await sha256(path)) === digest,
      "Backup changed while restoring; target unchanged.",
    );
    if (await exists(`${path}.json`)) {
      const manifest = JSON.parse(await readFile(`${path}.json`, "utf8"));
      const check = await client(c, "migrator", staging);
      try {
        for (const [table, count] of Object.entries(manifest.rowCounts ?? {})) {
          const actual = (
            await check.query(
              `SELECT count(*)::text AS n FROM public.${qi(table)}`,
            )
          ).rows[0].n;
          requireThat(
            actual === count,
            "Restored row counts differ from the backup snapshot. Target unchanged.",
          );
        }
      } finally {
        await check.end();
      }
    }
    await plan(c, staging);
    await migrate(c, staging);
    await grants(c, staging);
    await verifyRuntime(c, staging);
    const db = await client(c, "migrator", staging);
    try {
      await db.query('SELECT count(*) FROM "User"');
      await db.query('SELECT count(*) FROM "AuditLog"');
    } finally {
      await db.end();
    }
    const connections = await adminSql(
      c,
      `SELECT count(*) FROM pg_stat_activity WHERE datname=${ql(c.database)};`,
    );
    requireThat(
      connections === "0",
      "Target has active connections. Stop Next.js/workers and retry. Validated staging database was retained for inspection.",
    );
    const safety = await backup(c);
    // PostgreSQL DDL lock atomically gates new connections; never forcibly kill clients.
    await adminSql(
      c,
      `ALTER DATABASE ${qi(c.database)} ALLOW_CONNECTIONS false;`,
    );
    const late = await adminSql(
      c,
      `SELECT count(*) FROM pg_stat_activity WHERE datname=${ql(c.database)};`,
    );
    if (late !== "0") {
      await adminSql(
        c,
        `ALTER DATABASE ${qi(c.database)} ALLOW_CONNECTIONS true;`,
      );
      requireThat(
        false,
        "A connection appeared during restore preparation. Target was left unchanged. Stop all clients before retrying.",
      );
    }
    console.log(
      `Recovery backup: ${safety}. Previous database will be retained as ${retained}.`,
    );
    // No automatic rollback/deletion: interruption here is explicit operator recovery.
    await adminSql(
      c,
      `ALTER DATABASE ${qi(c.database)} RENAME TO ${qi(retained)};`,
    );
    await adminSql(
      c,
      `ALTER DATABASE ${qi(staging)} RENAME TO ${qi(c.database)};`,
    );
    await adminSql(
      c,
      `COMMENT ON DATABASE ${qi(c.database)} IS ${ql(`fahriva-local:${c.id}`)};`,
    );
    await grants(c);
    await verifyRuntime(c);
    requireThat(
      (await plan(c)).length === 0,
      "Restored database has pending migrations.",
    );
    console.log(
      `Restore verified. Previous database retained with connections disabled: ${retained}.`,
    );
  } catch (error) {
    console.error(
      `Restore stopped. Inspect databases fahriva, ${staging}, ${retained}. Nothing is automatically dropped or rolled back. See docs/LOCAL-DATABASE.md.`,
    );
    throw error;
  }
}
