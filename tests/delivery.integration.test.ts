import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import { database } from "../src/server/db";
import { saveDelivery, listDelivery } from "../src/features/delivery/service";
import type { Principal } from "../src/server/policy";
let engine: PGlite, server: PGLiteSocketServer;
let id: string;
const p: Principal = {
  userId: "delivery-admin",
  organizationId: "delivery-org",
  role: "ADMIN",
  driverId: null,
  name: "Admin",
  email: "delivery@example.test",
  organizationName: "Delivery",
};
const body = {
  driverId: "delivery-driver",
  kind: "PHR",
  date: "2027-01-01",
  intendedLocation: "Haustür",
  actualLocation: "Briefkasten",
  sourceReference: "Bericht 4711",
};
beforeAll(async () => {
  engine = await PGlite.create();
  for (const dir of (
    await readdir("prisma/migrations", { withFileTypes: true })
  )
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await engine.exec(
      await readFile(`prisma/migrations/${dir.name}/migration.sql`, "utf8"),
    );
  server = new PGLiteSocketServer({
    db: engine,
    port: 5442,
    host: "127.0.0.1",
  });
  await server.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5442/postgres";
  const db = database();
  await db.organization.createMany({
    data: [
      { id: p.organizationId, name: "Delivery" },
      { id: "delivery-other", name: "Other" },
    ],
  });
  await db.user.create({
    data: { id: p.userId, name: p.name, email: p.email },
  });
  await db.membership.create({
    data: { userId: p.userId, organizationId: p.organizationId, role: "ADMIN" },
  });
  await db.driverProfile.createMany({
    data: [
      {
        id: body.driverId,
        organizationId: p.organizationId,
        firstName: "Lena",
        lastName: "Weber",
        email: "delivery-driver@example.test",
        transporterId: "DEL-1",
      },
      {
        id: "foreign-driver",
        organizationId: "delivery-other",
        firstName: "Other",
        lastName: "Person",
        email: "foreign@example.test",
        transporterId: "DEL-2",
      },
    ],
  });
}, 30000);
afterAll(async () => {
  await database().$disconnect();
  if (server) await server.stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (engine) await engine.close();
});
it("creates explicitly sourced details with a server-derived calendar week", async () => {
  const result = await saveDelivery(p, "create", undefined, body);
  id = result.item.id;
  expect(result.item).toMatchObject({ revision: 1, week: "2026-W53" });
  expect(await database().auditLog.count({ where: { resourceId: id } })).toBe(
    1,
  );
});
it("denies non-admin writes and cross-tenant driver ids", async () => {
  await expect(
    saveDelivery(
      { ...p, role: "DRIVER", driverId: body.driverId },
      "create",
      undefined,
      body,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    saveDelivery(p, "create", undefined, {
      ...body,
      driverId: "foreign-driver",
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it("returns only the driver's details and rejects manipulated scope", async () => {
  const driver = { ...p, role: "DRIVER" as const, driverId: body.driverId };
  expect(
    (await listDelivery(driver, new URLSearchParams({ week: "2026-W53" })))
      .items,
  ).toHaveLength(1);
  await expect(
    listDelivery(
      driver,
      new URLSearchParams({ week: "2026-W53", driverId: "foreign-driver" }),
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it("preserves the old payload and rejects corrections based on stale revisions", async () => {
  const next = await saveDelivery(p, "update", id, {
    ...body,
    actualLocation: "Nachbar",
    correctionReason: "Abgleich mit Zustellnachweis",
  });
  expect(next.item.revision).toBe(2);
  expect(
    await database().deliveryDetail.findUnique({ where: { id } }),
  ).toMatchObject({ actualLocation: "Briefkasten", isCurrent: false });
  const current = await listDelivery(
    p,
    new URLSearchParams({ week: "2026-W53" }),
  );
  expect(current.items).toHaveLength(1);
  expect(current.items[0].actualLocation).toBe("Nachbar");
  await expect(
    saveDelivery(p, "update", id, { ...body, correctionReason: "Erneut" }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.query('UPDATE "DeliveryDetail" SET notes=$1 WHERE id=$2', [
      "Overwrite history",
      id,
    ]),
  ).rejects.toThrow();
});
it("rechecks live admin membership before writes", async () => {
  await database().membership.updateMany({
    where: { userId: p.userId },
    data: { active: false },
  });
  await expect(
    saveDelivery(p, "create", undefined, body),
  ).rejects.toMatchObject({ status: 403 });
});
