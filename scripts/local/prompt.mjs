import { createInterface } from "node:readline/promises";
import { requireThat, LocalError } from "./core.mjs";
export async function ask(label) {
  requireThat(
    process.stdin.isTTY,
    "Interactive input unavailable. Supply documented one-time environment values, or --yes for an intentional restore.",
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(label)).trim();
  } finally {
    rl.close();
  }
}
export async function password(label) {
  requireThat(
    process.stdin.isTTY && process.stdin.setRawMode,
    "A terminal is required for hidden password entry. Supply SEED_ADMIN_PASSWORD explicitly for automation.",
  );
  process.stdout.write(label);
  const input = process.stdin;
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      input.off("data", data);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }
    function data(chunk) {
      for (const char of chunk) {
        if (char === "\u0003") {
          finish(new LocalError("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    input.on("data", data);
  });
}
