import { URL } from "node:url";
/** Dependency-free validation shared by the CLI and Node's built-in tests. */
export class LocalError extends Error {}
export const requireThat = (ok, message) => {
  if (!ok) throw new LocalError(message);
};
export function nodeSupported(version) {
  const [major, minor] = version.split(".").map(Number);
  return /^24\.\d+\.\d+$/.test(version) && major === 24 && minor >= 19;
}
export function parseArgs(argv) {
  const [command, ...args] = argv;
  requireThat(
    ["bootstrap", "dev", "upgrade", "backup", "restore", "status"].includes(
      command,
    ),
    "Use local:bootstrap, local:dev, db:upgrade, db:backup, db:restore or db:status.",
  );
  const result = { command, restore: undefined, yes: false, port: undefined };
  if (command === "restore") {
    requireThat(
      args[0] && !args[0].startsWith("-"),
      "Restore requires a custom-format .dump path.",
    );
    result.restore = args.shift();
  }
  while (args.length) {
    const flag = args.shift();
    if (flag === "--yes" && result.restore) result.yes = true;
    else if (
      flag === "--restore" &&
      command === "bootstrap" &&
      !result.restore
    ) {
      requireThat(
        args[0] && !args[0].startsWith("-"),
        "--restore requires a backup path.",
      );
      result.restore = args.shift();
    } else if (flag === "--port" && command === "bootstrap") {
      result.port = Number(args.shift());
      requireThat(
        Number.isInteger(result.port) &&
          result.port > 1023 &&
          result.port < 65536,
        "Use --port with an integer from 1024 to 65535.",
      );
    } else
      throw new LocalError(
        "Unknown or misplaced option. No reset/force-reset option exists.",
      );
  }
  return result;
}
export function migrationPlan(local, history) {
  requireThat(local.length > 0, "No checked-in migrations found.");
  const successful = new Map();
  for (const row of history) {
    if (row.rolled_back_at) continue;
    requireThat(
      row.finished_at,
      "Unfinished migration detected. Stop and inspect _prisma_migrations with the migration identity; do not reset or auto-resolve.",
    );
    const source = local.find((m) => m.name === row.migration_name);
    requireThat(
      source && source.checksum === row.checksum,
      "Unknown migration or checksum mismatch. Use the matching source release; historical migrations must not be edited.",
    );
    requireThat(
      !successful.has(row.migration_name),
      "Duplicate successful migration history. Manual review required.",
    );
    successful.set(row.migration_name, true);
  }
  let pending = false;
  const plan = [];
  for (const migration of local) {
    if (!successful.has(migration.name)) {
      pending = true;
      plan.push(migration.name);
    } else
      requireThat(
        !pending,
        "Migration history is not a prefix of this release. Stop for manual review.",
      );
  }
  return plan;
}
export function safeEnvironment(env = process.env) {
  // Only operating-system and explicitly needed package/proxy variables survive.
  const allowed =
    /^(PATH|Path|HOME|USERPROFILE|SYSTEMROOT|SystemRoot|COMSPEC|ComSpec|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_ALL|TERM|CI|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|https_proxy|http_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR)$/;
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => allowed.test(key)),
  );
}
export function validateConfig(c) {
  requireThat(
    c?.version === 1 && /^[a-f0-9-]{36}$/.test(c.id),
    "Invalid local database configuration. Restore the private configuration backup; do not regenerate it over an existing volume.",
  );
  requireThat(
    /^fahriva_[a-f0-9]{12}$/.test(c.project) && c.database === "fahriva",
    "Invalid managed project/database identity.",
  );
  requireThat(
    Number.isInteger(c.port) && c.port > 1023 && c.port < 65536,
    "Invalid configured database port.",
  );
  for (const key of ["migratorPassword", "runtimePassword"])
    requireThat(
      /^[a-f0-9]{64}$/.test(c[key]),
      "Invalid local database credential.",
    );
  requireThat(
    c.migratorPassword !== c.runtimePassword,
    "Database identities require distinct credentials.",
  );
  return c;
}
export const roles = {
  admin: "fahriva_bootstrap",
  migrator: "fahriva_migrator",
  runtime: "fahriva_app",
};
export const identifier = (v) => '"' + v.replaceAll('"', '""') + '"';
export const literal = (v) => "'" + v.replaceAll("'", "''") + "'";
export function connectionUrl(c, role, database = c.database) {
  const url = new URL(`postgresql://127.0.0.1:${c.port}/${database}`);
  url.username = roles[role];
  url.password = c[`${role}Password`];
  return url.toString();
}
