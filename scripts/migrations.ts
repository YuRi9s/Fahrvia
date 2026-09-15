import { readdir, readFile } from "node:fs/promises";
/** Runs checked-in migrations in lexical order for disposable test databases only. */
export async function migrationSql() {
  const names = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return Promise.all(
    names.map((name) =>
      readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    ),
  );
}
