import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  lockLocal,
  loadConfig,
  setupFiles,
  portAvailable,
} from "../../scripts/local/config.mjs";
import { run } from "../../scripts/local/process.mjs";
const original = process.cwd();
const example = await readFile(".env.example", "utf8");
async function freshConfig() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return loadConfig({ command: "bootstrap", port });
}
async function temporary(work) {
  const dir = await mkdtemp(join(tmpdir(), "fahriva-local-unit-"));
  process.chdir(dir);
  try {
    await writeFile(".env.example", example);
    await work(dir);
  } finally {
    process.chdir(original);
    await rm(dir, { recursive: true, force: true });
  }
}
test("fresh config generates distinct secrets and repeated bootstrap preserves exact bytes", async () =>
  temporary(async () => {
    const release = await lockLocal();
    const c = await freshConfig();
    await setupFiles(c);
    const before = await readFile(".env", "utf8"),
      saved = await readFile(".local-db/config.json", "utf8"),
      secret = await readFile(".local-db/bootstrap-password", "utf8");
    assert(!before.includes(c.migratorPassword));
    assert(!before.includes(secret.trim()));
    assert(!before.includes("SEED_ADMIN_PASSWORD="));
    const second = await loadConfig({ command: "bootstrap" });
    await setupFiles(second);
    assert.equal(await readFile(".env", "utf8"), before);
    assert.equal(await readFile(".local-db/config.json", "utf8"), saved);
    assert.equal(
      await readFile(".local-db/bootstrap-password", "utf8"),
      secret,
    );
    await assert.rejects(lockLocal(), /Another operation/);
    await release();
  }));
test("unmanaged environment is never overwritten", async () =>
  temporary(async () => {
    await mkdir(".local-db", { mode: 0o700 });
    await writeFile(".env", "DATABASE_URL=do-not-touch", { mode: 0o600 });
    await assert.rejects(loadConfig({ command: "bootstrap" }), /unmanaged/);
    assert.equal(await readFile(".env", "utf8"), "DATABASE_URL=do-not-touch");
  }));
test("privileged env entries and Next override files are blocked", async () =>
  temporary(async () => {
    const unlock = await lockLocal();
    const c = await freshConfig();
    await setupFiles(c);
    const env = await readFile(".env", "utf8");
    await writeFile(".env", env + "\nSEED_ADMIN_PASSWORD=forbidden\n");
    await assert.rejects(setupFiles(c), /one-time/);
    await writeFile(".env", env);
    await writeFile(".env.local", "DATABASE_URL=override");
    await assert.rejects(setupFiles(c), /override/);
    await unlock();
  }));
test("broad private permissions fail rather than silently exposing credentials", async () =>
  temporary(async () => {
    if (process.platform === "win32") return;
    const unlock = await lockLocal();
    const c = await freshConfig();
    await setupFiles(c);
    await chmod(".env", 0o644);
    await assert.rejects(setupFiles(c), /permissions/);
    await unlock();
  }));
test("occupied host port fails with actionable diagnosis", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(portAvailable(server.address().port), /occupied/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test("process failure suppresses raw credentials and is not reported as success", async () => {
  const secret = "do-not-log-this-secret";
  await assert.rejects(
    run(
      process.execPath,
      ["-e", `console.error('${secret}');process.exit(4)`],
      { label: "Test step" },
    ),
    (error) =>
      !error.message.includes(secret) && error.message.includes("exit 4"),
  );
  await assert.rejects(
    run("fahriva-no-such-executable", [], { label: "Docker" }),
    /unavailable/,
  );
});
test("archive listing may stop reading early, but failed restore input is still rejected", async () =>
  temporary(async () => {
    await writeFile("large.dump", Buffer.alloc(4 * 1024 * 1024));
    await assert.doesNotReject(
      run(
        process.execPath,
        [
          "-e",
          'process.stdin.once("data",()=>{console.log("TOC");process.exit(0)})',
        ],
        { inputFile: "large.dump", allowEarlyInputClose: true },
      ),
    );
  }));
test("new-machine restore keeps the supplied MFA secret out of operator credentials", async () =>
  temporary(async () => {
    const old = process.env.RESTORE_AUTH_SECRET;
    const secret = "restored-auth-secret-".repeat(4);
    process.env.RESTORE_AUTH_SECRET = secret;
    let unlock;
    try {
      unlock = await lockLocal();
      const c = await freshConfig();
      await setupFiles(c, { restore: "trusted.dump" });
      assert(
        (await readFile(".env", "utf8")).includes(
          `BETTER_AUTH_SECRET=${secret}`,
        ),
      );
      assert(
        !(await readFile(".local-db/config.json", "utf8")).includes(secret),
      );
    } finally {
      if (old === undefined) delete process.env.RESTORE_AUTH_SECRET;
      else process.env.RESTORE_AUTH_SECRET = old;
      if (unlock) await unlock();
    }
  }));
