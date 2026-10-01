import { URL } from "node:url";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  roles,
  identifier as qi,
  literal as ql,
  requireThat,
  connectionUrl,
  migrationPlan,
  LocalError,
} from "./core.mjs";
import { run } from "./process.mjs";
import { exists, portAvailable } from "./config.mjs";
export async function dockerPreflight() {
  await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
    label: "Docker daemon",
    timeout: 15000,
  });
  const version = await run("docker", ["compose", "version", "--short"], {
    label: "Docker Compose",
    timeout: 15000,
  });
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  requireThat(
    major > 2 || (major === 2 && minor >= 20),
    "Docker Compose 2.20+ is required for health-based --wait startup.",
  );
}
export function compose(c, args, options = {}) {
  return run(
    "docker",
    [
      "compose",
      "--project-name",
      c.project,
      "--env-file",
      ".local-db/compose.env",
      "--file",
      "compose.yaml",
      ...args,
    ],
    { label: "Docker Compose", ...options },
  );
}
export function adminSql(c, sql, database = "postgres") {
  return compose(
    c,
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      roles.admin,
      "-d",
      database,
    ],
    { input: sql, label: "PostgreSQL administrative check" },
  );
}
export async function startDatabase(c) {
  if (await exists(".local-db/database-created")) {
    await run("docker", ["volume", "inspect", `${c.project}_postgres_data`], {
      label:
        "Existing database volume check (recover the original volume or restore into a new checkout; bootstrap will not recreate a lost volume)",
    });
  }
  const id = await compose(c, ["ps", "--all", "--quiet", "postgres"]);
  let running = false;
  if (id) {
    requireThat(
      !id.includes("\n"),
      "More than one managed PostgreSQL container exists. Inspect the Compose project.",
    );
    const data = JSON.parse(
      await run("docker", ["inspect", id], {
        label: "Container identity check",
      }),
    )[0];
    requireThat(
      data.Config.Labels["com.docker.compose.project"] === c.project &&
        data.Config.Labels["com.docker.compose.service"] === "postgres" &&
        data.Config.Image === "postgres:18.6-bookworm",
      "Container identity/image differs from the managed configuration. No replacement attempted.",
    );
    const bindings = data.HostConfig.PortBindings?.["5432/tcp"];
    requireThat(
      bindings?.length === 1 &&
        bindings[0].HostIp === "127.0.0.1" &&
        bindings[0].HostPort === String(c.port),
      "Existing container port binding differs from configuration. Stop for manual review.",
    );
    running = data.State.Running;
  }
  if (!running) await portAvailable(c.port);
  await writeFile(
    ".local-db/initialized",
    "Docker initialization attempted; preserve configuration and secrets.\n",
    { mode: 0o600 },
  );
  await compose(
    c,
    ["up", "-d", "--no-recreate", "--wait", "--wait-timeout", "90", "postgres"],
    {
      timeout: 180000,
      label:
        "PostgreSQL health check/startup (inspect Docker status if it fails)",
    },
  );
  const version = await adminSql(
    c,
    "SELECT current_setting('server_version_num');",
  );
  requireThat(
    version === "180006",
    "Expected PostgreSQL 18.6. The managed workflow never upgrades an existing data volume implicitly.",
  );
}
export async function client(c, role = "migrator", database = c.database) {
  const { Client } = await import("pg");
  const db = new Client({
    connectionString: connectionUrl(c, role, database),
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  try {
    await db.connect();
  } catch {
    await db.end().catch(() => {});
    throw new LocalError(
      "Saved database credentials failed authentication or connection. Check container health and recover the matching private configuration; passwords are never reset automatically.",
    );
  }
  return db;
}
export async function clusterLock(c) {
  const password = (
    await readFile(".local-db/bootstrap-password", "utf8")
  ).trim();
  const url = new URL(`postgresql://127.0.0.1:${c.port}/postgres`);
  url.username = roles.admin;
  url.password = password;
  const { Client } = await import("pg");
  const db = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  try {
    await db.connect();
    const viaDocker = await adminSql(
      c,
      "SELECT system_identifier::text FROM pg_control_system();",
    );
    const viaHost = (
      await db.query("SELECT system_identifier::text FROM pg_control_system()")
    ).rows[0].system_identifier;
    requireThat(
      viaDocker === viaHost,
      "Host endpoint is not the managed PostgreSQL instance.",
    );
    requireThat(
      (await db.query("SELECT pg_try_advisory_lock(724198321) AS locked"))
        .rows[0].locked,
      "Another Fahriva database operation holds the cluster lock.",
    );
    return async () => {
      await db.end();
    };
  } catch (e) {
    await db.end().catch(() => {});
    throw e;
  }
}
export async function provision(c, allowCreate) {
  const row = JSON.parse(
    await adminSql(
      c,
      `SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT datname,pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=${ql(c.database)}) x;`,
    ),
  );
  if (row.length)
    requireThat(
      row[0].marker === `fahriva-local:${c.id}` &&
        row[0].owner === roles.migrator,
      "Database identity/owner does not match. No grants, migrations or replacements were attempted.",
    );
  else {
    requireThat(
      !(await exists(".local-db/database-created")),
      "Previously initialized target database is missing. Stop for explicit recovery; bootstrap will not recreate it.",
    );
    requireThat(
      (await adminSql(
        c,
        `SELECT count(*) FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=${ql(roles.migrator)});`,
      )) === "0",
      "Migration-owned databases exist but target is absent. Inspect interrupted restore state; automatic creation refused.",
    );
    requireThat(
      allowCreate,
      "Managed database is missing. Only local:bootstrap may create it; upgrade/backup never recreate databases.",
    );
  }
  const found = JSON.parse(
    await adminSql(
      c,
      `SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication,rolinherit FROM pg_roles WHERE rolname IN (${ql(roles.migrator)},${ql(roles.runtime)})) x;`,
    ),
  );
  for (const name of [roles.migrator, roles.runtime]) {
    const role = found.find((r) => r.rolname === name);
    if (role)
      requireThat(
        !role.rolsuper &&
          !role.rolcreatedb &&
          !role.rolcreaterole &&
          !role.rolbypassrls &&
          !role.rolreplication &&
          !role.rolinherit,
        "An existing local database role has unexpected powers. Stop for manual review.",
      );
    else {
      requireThat(
        !row.length && allowCreate,
        "A required role is missing from an existing database; automatic repair refused.",
      );
      const password =
        name === roles.migrator ? c.migratorPassword : c.runtimePassword;
      await adminSql(
        c,
        `CREATE ROLE ${qi(name)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${ql(password)};`,
      );
    }
  }
  const memberships = await adminSql(
    c,
    `SELECT count(*) FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN (${ql(roles.runtime)},${ql(roles.migrator)}));`,
  );
  requireThat(
    memberships === "0",
    "Managed roles must not inherit or SET ROLE into other roles.",
  );
  if (!row.length) {
    await adminSql(
      c,
      `CREATE DATABASE ${qi(c.database)} OWNER ${qi(roles.migrator)} TEMPLATE template0;`,
    );
    await adminSql(
      c,
      `COMMENT ON DATABASE ${qi(c.database)} IS ${ql(`fahriva-local:${c.id}`)};`,
    );
    await adminSql(
      c,
      `ALTER SCHEMA public OWNER TO ${qi(roles.migrator)}; REVOKE ALL ON SCHEMA public FROM PUBLIC;`,
      c.database,
    );
  }
  await adminSql(
    c,
    "REVOKE CONNECT,TEMPORARY ON DATABASE postgres FROM PUBLIC; REVOKE CONNECT,TEMPORARY ON DATABASE template1 FROM PUBLIC;",
  );
  await writeFile(
    ".local-db/database-created",
    "Managed database exists; a missing target requires explicit recovery.\n",
    { mode: 0o600 },
  );
  // Check both saved credentials before proceeding; never rotate on mismatch.
  for (const role of ["migrator", "runtime"]) {
    const db = await client(c, role);
    await db.end();
  }
}
export async function sources() {
  const dirs = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return Promise.all(
    dirs.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(`prisma/migrations/${name}/migration.sql`))
        .digest("hex"),
    })),
  );
}
export async function history(c, database = c.database) {
  const db = await client(c, "migrator", database);
  try {
    const exists = (
      await db.query(
        "SELECT to_regclass('public._prisma_migrations') AS present",
      )
    ).rows[0].present;
    if (!exists) {
      const count = (
        await db.query(
          "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')",
        )
      ).rows[0].n;
      requireThat(
        count === 0,
        "Populated database without Prisma history. Never baseline or reset it automatically.",
      );
      return [];
    }
    return (
      await db.query(
        "SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY started_at",
      )
    ).rows;
  } finally {
    await db.end();
  }
}
export async function plan(c, database = c.database) {
  return migrationPlan(await sources(), await history(c, database));
}
export async function migrate(c, database = c.database) {
  console.log("Applying checked-in migrations with the migration identity.");
  await run(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { DATABASE_URL: connectionUrl(c, "migrator", database) },
      timeout: 600000,
      label:
        "Prisma migrate deploy; inspect migration history and the pre-operation backup before manual recovery",
    },
  );
  requireThat(
    (await plan(c, database)).length === 0,
    "Migration verification found pending migrations.",
  );
  await run(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "status"],
    {
      env: { DATABASE_URL: connectionUrl(c, "migrator", database) },
      label: "Prisma migration status",
    },
  );
}
export async function grants(c, database = c.database) {
  const db = await client(c, "migrator", database);
  try {
    await db.query(`BEGIN;
      REVOKE ALL ON DATABASE ${qi(database)} FROM PUBLIC;
      REVOKE ALL ON DATABASE ${qi(database)} FROM ${qi(roles.runtime)};
      GRANT CONNECT ON DATABASE ${qi(database)} TO ${qi(roles.runtime)};
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      REVOKE ALL ON SCHEMA public FROM ${qi(roles.runtime)};
      GRANT USAGE ON SCHEMA public TO ${qi(roles.runtime)};
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${qi(roles.runtime)};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${qi(roles.runtime)};
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${qi(roles.runtime)};
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${qi(roles.runtime)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(roles.migrator)} IN SCHEMA public REVOKE ALL ON TABLES FROM ${qi(roles.runtime)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(roles.migrator)} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${qi(roles.runtime)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(roles.migrator)} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${qi(roles.runtime)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${qi(roles.migrator)} IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${qi(roles.runtime)};
      REVOKE ALL ON public._prisma_migrations FROM ${qi(roles.runtime)};
      GRANT SELECT ON public._prisma_migrations TO ${qi(roles.runtime)};
      COMMIT;`);
  } finally {
    await db.end();
  }
}
export async function verifyRuntime(c, database = c.database) {
  const db = await client(c, "runtime", database);
  try {
    const r = (
      await db.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
      has_database_privilege(current_user,current_database(),'TEMP') AS db_temp,
      has_table_privilege(current_user,'public._prisma_migrations','UPDATE') AS history_write,
      has_table_privilege(current_user,'public."AuditLog"','TRUNCATE') AS audit_truncate
      FROM pg_roles WHERE rolname=current_user`)
    ).rows[0];
    requireThat(
      Object.values(r).every((v) => v === false),
      "Runtime role has elevated privileges; local operation blocked.",
    );
    const owned = (
      await db.query(
        `SELECT count(*)::int AS n FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`,
      )
    ).rows[0].n;
    requireThat(
      owned === 0,
      "Runtime identity owns database objects. Stop for manual review.",
    );
    await db.query('SELECT id FROM "Organization" LIMIT 1');
    await db.query("SELECT migration_name FROM _prisma_migrations LIMIT 1");
  } finally {
    await db.end();
  }
}
