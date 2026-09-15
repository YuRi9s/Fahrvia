import { spawn } from "node:child_process";
import { AppError } from "../../server/policy";
import type { DriverIdentity, normalizeRows } from "./parser";
let active = 0;
/** CPU-heavy file parsing runs outside the HTTP heap and is terminated after five seconds. */
export async function parseIsolated(
  data: Uint8Array,
  filename: string,
  week: string,
  mapping: Record<string, string>,
  drivers: DriverIdentity[],
): Promise<ReturnType<typeof normalizeRows>> {
  if (active >= 2)
    throw new AppError(
      429,
      "Zwei Importe werden bereits geprüft. Bitte kurz warten.",
    );
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--max-old-space-size=128", "workers/score/worker.mjs"],
        {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: { NODE_ENV: process.env.NODE_ENV },
        },
      );
      let settled = false;
      const finish = (
        error?: Error,
        result?: ReturnType<typeof normalizeRows>,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(
        () =>
          finish(new AppError(422, "Die Dateiprüfung hat zu lange gedauert.")),
        5000,
      );
      child.once("error", () =>
        finish(new AppError(503, "Die Dateiprüfung ist nicht verfügbar.")),
      );
      child.once("exit", () =>
        finish(
          new AppError(422, "Die Datei überschreitet das Verarbeitungsbudget."),
        ),
      );
      child.once("message", (message: unknown) => {
        const m = message as {
          ok: boolean;
          result: ReturnType<typeof normalizeRows>;
          message: string;
        };
        if (m.ok) finish(undefined, m.result);
        else finish(new AppError(422, m.message));
      });
      child.send({
        bytes: Buffer.from(data).toString("base64"),
        filename,
        week,
        mapping,
        drivers,
      });
    });
  } finally {
    active--;
  }
}
