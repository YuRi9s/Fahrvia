import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { fleetDb?: PrismaClient };
/** Lazy construction permits a build without contacting production infrastructure. */
export function database() {
  if (!globalDb.fleetDb) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    globalDb.fleetDb = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: process.env.NODE_ENV === "test" ? 1 : 10,
      }),
    });
  }
  return globalDb.fleetDb;
}
