import { setTimeout, clearTimeout } from "node:timers";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { LocalError, safeEnvironment } from "./core.mjs";
/** Capture tool output privately: tools/SQL can echo credentials on failure. */
export async function run(
  file,
  args,
  {
    cwd = process.cwd(),
    env = {},
    input,
    inputFile,
    allowEarlyInputClose = false,
    outputFile,
    timeout = 120000,
    label = "Command",
    inherit = false,
  } = {},
) {
  const child = spawn(file, args, {
    cwd,
    env: { ...safeEnvironment(), ...env },
    shell: false,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  let output = "";
  if (!inherit && !outputFile)
    child.stdout.on("data", (chunk) => {
      if (output.length < 1024 * 1024) output += chunk;
    });
  if (!inherit) child.stderr.on("data", () => {});
  const timer = timeout
    ? setTimeout(() => child.kill("SIGTERM"), timeout)
    : null;
  const killTimer = timeout
    ? setTimeout(() => child.kill("SIGKILL"), timeout + 5000)
    : null;
  let inputPipe = Promise.resolve(),
    outputPipe = Promise.resolve();
  if (!inherit) {
    child.stdin.on("error", () => {});
    if (inputFile)
      inputPipe = pipeline(createReadStream(inputFile), child.stdin);
    else child.stdin.end(input ?? "");
    if (outputFile)
      outputPipe = pipeline(
        child.stdout,
        createWriteStream(outputFile, { flags: "wx", mode: 0o600 }),
      );
  }
  // Attach failure handlers immediately, including early child exit/EPIPE.
  inputPipe.catch(() => {});
  outputPipe.catch(() => {});
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", () =>
        reject(
          new LocalError(
            `${label} unavailable. Check installation and permissions.`,
          ),
        ),
      );
      child.once("close", resolve);
    });
    await Promise.all([
      inputPipe.catch((error) => {
        if (
          code === 0 &&
          allowEarlyInputClose &&
          ["EPIPE", "ERR_STREAM_PREMATURE_CLOSE"].includes(error.code)
        )
          return;
        throw error;
      }),
      outputPipe,
    ]);
    if (code !== 0)
      throw new LocalError(
        `${label} failed (exit ${code ?? "signal"}). No database reset was attempted. Check the documented recovery procedure.`,
      );
    return output.trim();
  } catch (error) {
    child.kill("SIGTERM");
    if (error instanceof LocalError) throw error;
    throw new LocalError(
      `${label} stream failed. The operation is incomplete; preserve the existing database and backup.`,
    );
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
  }
}
