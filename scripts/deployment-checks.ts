export type Check = {
  name: string;
  status: "PASS" | "BLOCKED";
  message: string;
};
export function configurationChecks(
  env: Record<string, string | undefined>,
  nodeVersion = process.versions.node,
): Check[] {
  const results: Check[] = [];
  const check = (name: string, ok: boolean, message: string) =>
    results.push({ name, status: ok ? "PASS" : "BLOCKED", message });
  const [major, minor] = nodeVersion.split(".").map(Number);
  check(
    "node",
    major === 24 && minor >= 19,
    "Requires Node 24.19 or later within major version 24.",
  );
  let database = false,
    origin = false;
  try {
    const url = new URL(env.DATABASE_URL || "");
    database =
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.pathname.length > 1 &&
      !/replace-|example|your-password/i.test(decodeURIComponent(url.password));
  } catch {
    // Invalid configuration remains blocked; never include its value in diagnostics.
  }
  check(
    "database_configuration",
    database,
    "Requires an explicit PostgreSQL database URL without example credentials.",
  );
  try {
    const url = new URL(env.BETTER_AUTH_URL || "");
    origin =
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/";
  } catch {
    // Invalid configuration remains blocked; never include its value in diagnostics.
  }
  check(
    "authentication_origin",
    origin,
    "Production requires a canonical HTTPS origin without a path, query or credentials.",
  );
  const secret = env.BETTER_AUTH_SECRET || "";
  check(
    "authentication_secret",
    secret.length >= 32 && !/replace-|example|change.?me/i.test(secret),
    "Requires a private authentication secret of at least 32 characters; randomness must be verified by the operator.",
  );
  check(
    "invitation_mode",
    !env.INVITATION_DELIVERY || env.INVITATION_DELIVERY === "email",
    "Production invitation delivery must use email.",
  );
  check(
    "bootstrap_removed",
    !Object.entries(env).some(
      ([key, value]) =>
        !!value && (key.startsWith("SEED_") || key.startsWith("PROVISION_")),
    ),
    "Remove one-time bootstrap/provisioning values from the runtime environment.",
  );
  return results;
}
export type LocalMigration = { name: string; checksum: string };
export type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: unknown;
  rolled_back_at: unknown;
};
export function migrationChecks(
  local: LocalMigration[],
  history: AppliedMigration[],
): Check[] {
  const result: Check[] = [];
  const known = new Map(local.map((m) => [m.name, m.checksum]));
  for (const row of history) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at)
      result.push({
        name: "migration_incomplete",
        status: "BLOCKED",
        message: `Unfinished migration: ${row.migration_name}`,
      });
    else if (!known.has(row.migration_name))
      result.push({
        name: "migration_unknown",
        status: "BLOCKED",
        message: `Database migration is absent from this release: ${row.migration_name}`,
      });
  }
  for (const migration of local) {
    const applied = history.filter(
      (r) =>
        r.migration_name === migration.name &&
        r.finished_at &&
        !r.rolled_back_at,
    );
    if (applied.length !== 1)
      result.push({
        name: "migration_pending",
        status: "BLOCKED",
        message: `Expected one successful application: ${migration.name}`,
      });
    else if (applied[0].checksum !== migration.checksum)
      result.push({
        name: "migration_checksum",
        status: "BLOCKED",
        message: `Migration contents differ: ${migration.name}`,
      });
  }
  if (!local.length)
    result.push({
      name: "migration_files",
      status: "BLOCKED",
      message: "No source migrations were found.",
    });
  if (!result.length)
    result.push({
      name: "migrations",
      status: "PASS",
      message: `All ${local.length} source migrations match successful database history.`,
    });
  return result;
}
