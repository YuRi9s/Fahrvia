/** Read-only source-deployment preflight. Never logs URLs, secrets or raw database errors. */
import { access, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  configurationChecks,
  migrationChecks,
  type Check,
  type AppliedMigration,
} from "./deployment-checks";
const results: Check[] = configurationChecks(process.env);
const check = (name: string, ok: boolean, message: string) =>
  results.push({ name, status: ok ? "PASS" : "BLOCKED", message });
for (const file of [
  ".next/BUILD_ID",
  ".next/server",
  "workers/score/worker.mjs",
  "workers/score/lib/src/features/score/parser.js",
  "workers/score/lib/src/server/validation.js",
  "workers/score/lib/src/server/policy.js",
  "workers/score/lib/src/lib/berlin-time.js",
]) {
  try {
    await access(file);
    check("build_file", true, `Present: ${file}`);
  } catch {
    check("build_file", false, `Missing: ${file}. Run npm run build.`);
  }
}
let local: { name: string; checksum: string }[] = [];
try {
  const directories = (
    await readdir("prisma/migrations", { withFileTypes: true })
  )
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  local = await Promise.all(
    directories.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(`prisma/migrations/${name}/migration.sql`))
        .digest("hex"),
    })),
  );
} catch {
  check(
    "migration_files",
    false,
    "Cannot read checked-in migration files from the project directory.",
  );
}
if (
  results.find((r) => r.name === "database_configuration")?.status === "PASS"
) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const runtime = await client.query<{
      version: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }>(
      "SELECT current_setting('server_version_num') AS version, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    const role = runtime.rows[0];
    check(
      "postgresql_version",
      !!role && Math.floor(Number(role.version) / 10000) === 18,
      "Native deployment targets PostgreSQL major version 18.",
    );
    check(
      "application_role",
      !!role &&
        !role.rolsuper &&
        !role.rolcreatedb &&
        !role.rolcreaterole &&
        !role.rolbypassrls,
      "Runtime role must not be superuser or have role/database creation or RLS-bypass privileges.",
    );
    const table = await client.query(
      "SELECT to_regclass('public._prisma_migrations') AS present",
    );
    if (!table.rows[0].present)
      check(
        "migration_history",
        false,
        "Prisma migration history is absent. Do not reset or baseline an existing populated database without review.",
      );
    else {
      const history = await client.query<AppliedMigration>(
        "SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at",
      );
      results.push(...migrationChecks(local, history.rows));
    }
    await client.query("ROLLBACK");
    check(
      "database_connection",
      true,
      "Read-only database inspection completed.",
    );
  } catch {
    check(
      "database_connection",
      false,
      "Read-only inspection failed. Check connectivity, TLS, database availability and permission to read migration history locally. No connection details are included.",
    );
  } finally {
    await client.end().catch(() => {});
  }
} else
  check(
    "database_connection",
    false,
    "Database inspection skipped because configuration is invalid.",
  );
if (process.argv.includes("--probe")) {
  if (
    results.find((r) => r.name === "authentication_origin")?.status !== "PASS"
  )
    check(
      "http_probe",
      false,
      "HTTPS checks skipped because the authentication origin is invalid.",
    );
  else
    for (const [path, expected] of [
      ["/api/health", "ok"],
      ["/api/ready", "ready"],
      ["/login", "html"],
    ]) {
      try {
        const response = await fetch(
          new URL(path, process.env.BETTER_AUTH_URL),
          { redirect: "error", signal: AbortSignal.timeout(10000) },
        );
        const valid =
          response.status === 200 &&
          (expected === "html"
            ? response.headers.get("content-type")?.includes("text/html")
            : (await response.json()).status === expected);
        check(
          "http_probe",
          !!valid,
          `HTTPS ${path}: ${valid ? "expected response received" : "unexpected response"}.`,
        );
        await response.body?.cancel().catch(() => {});
      } catch {
        check(
          "http_probe",
          false,
          `HTTPS ${path} failed. Check service, proxy and TLS locally.`,
        );
      }
    }
}
const passed = results.every((r) => r.status === "PASS");
console.log(
  JSON.stringify(
    {
      stage: 19,
      status: passed ? "PREFLIGHT_PASSED" : "BLOCKED",
      checks: results,
      remaining: [
        "Confirm native PostgreSQL and clean-install/upgrade migration runs on a disposable database.",
        "Start the production service and check HTTPS login, health and readiness through the actual proxy.",
        "Qualify file storage, scanner, email, browser flows, backups and monitoring in their scheduled stages.",
      ],
    },
    null,
    2,
  ),
);
process.exitCode = passed ? 0 : 1;
