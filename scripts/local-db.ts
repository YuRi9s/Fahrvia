/** Development/test-only PostgreSQL protocol helper; production uses PostgreSQL 18. */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdir } from "node:fs/promises";
import { migrationSql } from "./migrations";
if (process.env.NODE_ENV === "production")
  throw new Error("The local test database cannot run in production");
await mkdir(".data", { recursive: true });
const db = await PGlite.create(".data/postgres");
const exists = await db.query<{ present: boolean }>(
  `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='Organization') AS present`,
);
if (!exists.rows[0].present) {
  for (const sql of await migrationSql()) await db.exec(sql);
}
const server = new PGLiteSocketServer({ db, port: 5439, host: "127.0.0.1" });
await server.start();
console.log("Development PostgreSQL protocol endpoint ready on port 5439.");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  });
