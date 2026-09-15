import ts from "typescript";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
// Keep the bounded parser in a separate process without requiring TypeScript in production.
for (const path of [
  "src/features/score/parser.ts",
  "src/server/policy.ts",
  "src/server/validation.ts",
  "src/lib/berlin-time.ts",
]) {
  const source = await readFile(path, "utf8");
  const js = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(/(from\s+["'])(\.[^"']+)(["'])/g, "$1$2.js$3");
  const dest = join("workers/score/lib", path.replace(/\.ts$/, ".js"));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, js);
}
