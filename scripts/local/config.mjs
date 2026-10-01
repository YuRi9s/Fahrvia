import { password } from "./prompt.mjs";
import { URL } from "node:url";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  open,
  unlink,
} from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  requireThat,
  validateConfig,
  connectionUrl,
  LocalError,
} from "./core.mjs";
import { run } from "./process.mjs";
export const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
export async function privateFile(path) {
  const s = await lstat(path);
  requireThat(
    s.isFile() && !s.isSymbolicLink(),
    "Private configuration must be a regular file, not a symlink.",
  );
  if (process.platform !== "win32")
    requireThat(
      (s.mode & 0o077) === 0,
      "Private configuration permissions are too broad. Use chmod 600 on .env and .local-db private files.",
    );
}
export async function lockLocal() {
  await mkdir(".local-db", { recursive: true, mode: 0o700 });
  const stat = await lstat(".local-db");
  requireThat(
    stat.isDirectory() && !stat.isSymbolicLink(),
    ".local-db must be a private local directory.",
  );
  if (process.platform !== "win32")
    requireThat((stat.mode & 0o077) === 0, "Run chmod 700 .local-db.");
  let handle;
  try {
    handle = await open(".local-db/operation.lock", "wx", 0o600);
  } catch {
    throw new LocalError(
      "Another operation is running, or a stale .local-db/operation.lock remains. Check processes before manually removing that lock.",
    );
  }
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );
  return async () => {
    await handle.close();
    await unlink(".local-db/operation.lock");
  };
}
export async function loadConfig(options) {
  if (await exists(".local-db/config.json")) {
    await privateFile(".local-db/config.json");
    const c = validateConfig(
      JSON.parse(await readFile(".local-db/config.json", "utf8")),
    );
    requireThat(
      !options.port || options.port === c.port,
      "Port override differs from saved configuration. Stop and edit the managed configuration and matching runtime URL deliberately; bootstrap never changes them silently.",
    );
    return c;
  }
  requireThat(
    options.command === "bootstrap",
    "Run npm run local:bootstrap first.",
  );
  requireThat(
    !(await exists(".env")),
    "An existing unmanaged .env was found. It was not changed. See docs/LOCAL-DATABASE.md for the native/legacy installation transfer procedure.",
  );
  requireThat(
    !(await exists(".local-db/bootstrap-password")),
    "Partial private configuration found. Recover config.json before proceeding; no credentials were replaced.",
  );
  await portAvailable(options.port ?? 55432);
  const c = {
    version: 1,
    id: randomUUID(),
    project: `fahriva_${randomBytes(6).toString("hex")}`,
    port: options.port ?? 55432,
    database: "fahriva",
    migratorPassword: randomBytes(32).toString("hex"),
    runtimePassword: randomBytes(32).toString("hex"),
  };
  await writeFile(".local-db/config.json", JSON.stringify(c, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return c;
}
export async function setupFiles(c, options = {}) {
  if (!(await exists(".local-db/bootstrap-password"))) {
    // This is safe only before this installation has ever initialized Docker.
    requireThat(
      !(await exists(".local-db/initialized")),
      "Bootstrap secret is missing from an existing installation. Recover it; never rotate implicitly.",
    );
    await writeFile(
      ".local-db/bootstrap-password",
      randomBytes(32).toString("hex") + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  await privateFile(".local-db/bootstrap-password");
  const compose = `LOCAL_DB_PORT=${c.port}\n`;
  await writeFile(".local-db/compose.env", compose, { mode: 0o600 });
  if (!(await exists(".env"))) {
    const sample = await readFile(".env.example", "utf8");
    const authSecret = options.restore
      ? process.env.RESTORE_AUTH_SECRET ||
        (await password(
          "Source BETTER_AUTH_SECRET (hidden; required to preserve MFA): ",
        ))
      : randomBytes(48).toString("hex");
    requireThat(
      authSecret.length >= 32 && /^[a-zA-Z0-9_+/=.-]+$/.test(authSecret),
      "Source authentication secret is invalid; use the original value, not a new one.",
    );
    const env = sample
      .replace(
        /^DATABASE_URL=.*$/m,
        `DATABASE_URL=${connectionUrl(c, "runtime")}`,
      )
      .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${authSecret}`);
    await writeFile(".env", env, { flag: "wx", mode: 0o600 });
  }
  await privateFile(".env");
  const env = parseEnv(await readFile(".env", "utf8"));
  requireThat(
    env.DATABASE_URL === connectionUrl(c, "runtime"),
    "Runtime DATABASE_URL does not match the managed database. Nothing was overwritten. Restore the matching private configuration or follow the transfer procedure.",
  );
  requireThat(
    (env.BETTER_AUTH_SECRET?.length ?? 0) >= 32 &&
      !/replace-|example/i.test(env.BETTER_AUTH_SECRET),
    "Set a private random BETTER_AUTH_SECRET in .env.",
  );
  requireThat(
    !Object.entries(env).some(
      ([k, v]) =>
        v && /^(SEED_|PROVISION_|PG|POSTGRES_|MIGRAT|LOCAL_DB_)/.test(k),
    ),
    "Remove one-time seed and privileged database credentials from runtime .env.",
  );
  for (const name of [
    ".env.local",
    ".env.development",
    ".env.development.local",
  ])
    requireThat(
      !(await exists(name)),
      "Next.js override env files exist. Consolidate local settings into .env before using the managed workflow.",
    );
  const url = new URL(env.BETTER_AUTH_URL);
  requireThat(
    url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "Local workflow requires a loopback HTTP BETTER_AUTH_URL. Production remains a separate explicit deployment.",
  );
  return env;
}
export async function dependencies() {
  const hash = createHash("sha256")
    .update(await readFile("package-lock.json"))
    .update(await readFile("package.json"))
    .update(process.versions.node)
    .update(process.platform)
    .update(process.arch)
    .digest("hex");
  const stamp = "node_modules/.fahriva-local-lock";
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  let installed =
    (await exists(stamp)) && (await readFile(stamp, "utf8")) === hash;
  if (installed)
    for (const [name, version] of Object.entries({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    })) {
      try {
        if (
          JSON.parse(
            await readFile(`node_modules/${name}/package.json`, "utf8"),
          ).version !== version
        )
          installed = false;
      } catch {
        installed = false;
      }
    }
  if (!installed) {
    console.log(
      "Installing exact lockfile dependencies (lifecycle scripts disabled).",
    );
    const npm = process.env.npm_execpath;
    requireThat(npm, "Invoke this workflow through npm run.");
    await run(
      process.execPath,
      [npm, "ci", "--ignore-scripts", "--omit=peer", "--include=dev"],
      { timeout: 600000, label: "Lockfile installation" },
    );
    await writeFile(stamp, hash, { mode: 0o600 });
  }
}
export async function portAvailable(port) {
  await new Promise((resolvePort, reject) => {
    const s = createServer();
    s.once("error", () =>
      reject(
        new LocalError(
          `Port ${port} is occupied or unavailable. Stop its owner or choose npm run local:bootstrap -- --port <free-port> in a fresh checkout. No other database was contacted.`,
        ),
      ),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolvePort));
  });
}
export async function atomicJson(path, data) {
  const temp = resolve(`${path}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temp, path);
}
