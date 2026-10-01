/** Source-only local operator. No external imports before npm ci. Never used by Next.js startup. */
import { URL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseArgs,
  nodeSupported,
  requireThat,
  LocalError,
  connectionUrl,
} from "./local/core.mjs";
import {
  lockLocal,
  loadConfig,
  setupFiles,
  dependencies,
} from "./local/config.mjs";
import {
  dockerPreflight,
  startDatabase,
  clusterLock,
  provision,
  plan,
  migrate,
  grants,
  verifyRuntime,
} from "./local/database.mjs";
import { backup, restore } from "./local/backup.mjs";
import { ensureAdmin } from "./local/admin.mjs";
import { run } from "./local/process.mjs";
let releaseLocal, releaseCluster;
try {
  process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  requireThat(
    nodeSupported(process.versions.node),
    "Requires Node >=24.19.0 <25.",
  );
  requireThat(
    process.env.NODE_ENV !== "production",
    "Local orchestration cannot run in production. Use the explicit production deployment/migration job.",
  );
  const options = parseArgs(process.argv.slice(2));
  await dockerPreflight();
  releaseLocal = await lockLocal();
  const c = await loadConfig(options);
  const env = await setupFiles(c, options);
  await dependencies();
  await startDatabase(c);
  releaseCluster = await clusterLock(c);
  await provision(c, options.command === "bootstrap");
  if (options.command === "backup") await backup(c);
  else {
    if (options.restore) await restore(c, options.restore, options.yes);
    else {
      const pending = await plan(c);
      if (options.command === "status")
        requireThat(
          !pending.length,
          `${pending.length} migrations pending. Run npm run db:upgrade.`,
        );
      else {
        // Upgrade always snapshots, even when no migration is pending; bootstrap/dev only if needed.
        if (options.command === "upgrade" || pending.length) await backup(c);
        if (
          pending.length ||
          options.command === "bootstrap" ||
          options.command === "upgrade"
        )
          await migrate(c);
      }
    }
    if (options.command !== "status") await grants(c);
    await verifyRuntime(c);
    await run(
      process.execPath,
      ["node_modules/prisma/build/index.js", "generate"],
      {
        env: { DATABASE_URL: connectionUrl(c, "migrator") },
        label: "Prisma client generation",
      },
    );
    const admin = await ensureAdmin(c, options.command === "bootstrap");
    console.log(
      `PostgreSQL 18.6 | 127.0.0.1:${c.port} | database: ${c.database}\nMigrations: verified, none pending | Admin: ${admin}\nApplication: ${env.BETTER_AUTH_URL} (start with npm run local:dev)`,
    );
  }
  await releaseCluster();
  releaseCluster = null;
  await releaseLocal();
  releaseLocal = null;
  if (options.command === "dev") {
    // Only application configuration reaches Next.js. No bootstrap/migrator/seed credentials.
    await run(process.execPath, ["scripts/build-score-worker.mjs"], {
      env,
      label: "Worker build",
    });
    const url = new URL(env.BETTER_AUTH_URL);
    console.log("Starting local Next.js. Database migrations are complete.");
    await run(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        url.port || "80",
      ],
      {
        env: { ...env, NODE_ENV: "development" },
        timeout: 0,
        inherit: true,
        label: "Next.js development server",
      },
    );
  }
} catch (error) {
  console.error(
    error instanceof LocalError
      ? error.message
      : "Local database operation failed. Credentials and raw tool output are suppressed. Check Docker availability, saved credentials, file permissions and docs/LOCAL-DATABASE.md. No reset or automatic rollback was attempted.",
  );
  process.exitCode = 1;
} finally {
  if (releaseCluster) await releaseCluster().catch(() => {});
  if (releaseLocal) await releaseLocal().catch(() => {});
}
