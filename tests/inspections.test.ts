import * as storage from "../src/features/uploads/storage";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { migrationSql } from "../scripts/migrations";
import { database } from "../src/server/db";
import type { Principal } from "../src/server/policy";
import {
  submitInspection,
  inspectionList,
} from "../src/features/inspections/service";
import { download } from "../src/features/uploads/service";
const driver: Principal = {
  userId: "inspection-driver",
  driverId: "inspection-profile",
  organizationId: "inspection-org",
  role: "DRIVER",
  name: "Driver",
  email: "driver@inspection.test",
  organizationName: "Fleet",
};
const admin: Principal = {
  ...driver,
  userId: "inspection-admin",
  driverId: null,
  role: "ADMIN",
  email: "admin@inspection.test",
};
let engine: PGlite,
  server: PGLiteSocketServer,
  entryId: string,
  assignmentId: string;
const images: Buffer[] = [];
beforeAll(async () => {
  engine = await PGlite.create();
  for (const sql of await migrationSql()) await engine.exec(sql);
  server = new PGLiteSocketServer({
    db: engine,
    port: 5468,
    host: "127.0.0.1",
  });
  await server.start();
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5468/postgres";
  const db = database();
  await db.organization.create({
    data: { id: driver.organizationId, name: "Fleet" },
  });
  for (const p of [driver, admin]) {
    await db.user.create({
      data: { id: p.userId, name: p.name, email: p.email },
    });
    await db.membership.create({
      data: {
        id: p.userId + "-member",
        userId: p.userId,
        organizationId: p.organizationId,
        role: p.role,
      },
    });
  }
  await db.driverProfile.create({
    data: {
      id: driver.driverId!,
      organizationId: driver.organizationId,
      membershipId: driver.userId + "-member",
      firstName: "Test",
      lastName: "Driver",
      email: driver.email,
    },
  });
  await db.vehicle.create({
    data: {
      id: "inspection-car",
      organizationId: driver.organizationId,
      plate: "TEST-22C",
      vin: "TEST22C",
      brand: "Test",
      model: "Van",
      year: 2025,
      ownership: "OWNED",
      inFleet: new Date("2025-01-01"),
    },
  });
  for (let i = 0; i < 5; i++)
    images.push(
      await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 3,
          background: { r: 30 + i * 40, g: 80, b: 120 },
        },
      })
        .png()
        .toBuffer(),
    );
}, 30000);
beforeEach(async () => {
  const db = database();
  await db.workTimeEntry.updateMany({
    where: { driverId: driver.driverId!, endAt: null },
    data: {
      endAt: new Date(),
      clockState: "FINISHED",
      status: "SUBMITTED",
      breakStartedAt: null,
    },
  });
  await db.vehicleAssignment.updateMany({
    where: { vehicleId: "inspection-car", endAt: null },
    data: { endAt: new Date() },
  });
  entryId = (
    await db.workTimeEntry.create({
      data: {
        organizationId: driver.organizationId,
        driverId: driver.driverId!,
        startAt: new Date(Date.now() - 60000),
        clockState: "RUNNING",
      },
    })
  ).id;
  assignmentId = (
    await db.vehicleAssignment.create({
      data: {
        organizationId: driver.organizationId,
        vehicleId: "inspection-car",
        driverId: driver.driverId!,
        createdBy: admin.userId,
      },
    })
  ).id;
});
afterAll(async () => {
  await database().$disconnect();
  await server?.stop();
  await engine?.close();
});
function form(damage = false) {
  const f = new FormData();
  f.set(
    "metadata",
    JSON.stringify({
      requestId: randomUUID(),
      entryId,
      assignmentId,
      odometerKm: 12345,
      tyres: "OK",
      lights: "OK",
      mirrors: "OK",
      warnings: "OK",
      damage,
      notes: damage ? "Scratch on the right side panel." : "",
    }),
  );
  ["front", "rear", "left", "right", ...(damage ? ["damage"] : [])].forEach(
    (slot, i) =>
      f.set(
        slot,
        new File([new Uint8Array(images[i])], slot + ".png", {
          type: "image/png",
        }),
      ),
  );
  return f;
}
function change(f: FormData, patch: Record<string, unknown>) {
  f.set(
    "metadata",
    JSON.stringify({ ...JSON.parse(String(f.get("metadata"))), ...patch }),
  );
  return f;
}
it("submits four private labelled images once and preserves running shift", async () => {
  const f = form();
  const r = await submitInspection(driver, f);
  expect(await submitInspection(driver, f)).toEqual(r);
  const list = await inspectionList(driver, 1);
  expect(list.items.filter((x) => x.id === r.id)).toHaveLength(1);
  expect(list.items.find((x) => x.id === r.id)?.report.files).toHaveLength(4);
  expect(
    (
      await database().workTimeEntry.findUniqueOrThrow({
        where: { id: entryId },
      })
    ).clockState,
  ).toBe("RUNNING");
  const photo = list.items.find((x) => x.id === r.id)!.report.files[0];
  expect((await download(driver, photo.objectId)).mime).toBe("image/jpeg");
});
it("rejects missing and repeated views", async () => {
  const f = form();
  f.delete("rear");
  await expect(submitInspection(driver, f)).rejects.toMatchObject({
    status: 422,
  });
  const repeat = form();
  repeat.set("rear", repeat.get("front")!);
  await expect(submitInspection(driver, repeat)).rejects.toMatchObject({
    status: 422,
  });
});
it("damage requires an image and descriptive notes", async () => {
  const f = form(true);
  f.delete("damage");
  await expect(submitInspection(driver, f)).rejects.toMatchObject({
    status: 422,
  });
  await expect(
    submitInspection(driver, change(form(true), { notes: "" })),
  ).rejects.toMatchObject({ status: 422 });
  expect((await submitInspection(driver, form(true))).id).toBeTruthy();
});
it("checklist issues require notes", async () => {
  await expect(
    submitInspection(driver, change(form(), { tyres: "ISSUE" })),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (
      await submitInspection(
        driver,
        change(form(), {
          tyres: "ISSUE",
          notes: "Tyre pressure warning; dispatch informed.",
        }),
      )
    ).id,
  ).toBeTruthy();
});
it("cannot submit while paused, after assignment ends, or against another shift", async () => {
  await database().workTimeEntry.update({
    where: { id: entryId },
    data: { clockState: "PAUSED", breakStartedAt: new Date() },
  });
  await expect(submitInspection(driver, form())).rejects.toMatchObject({
    status: 409,
  });
  await database().workTimeEntry.update({
    where: { id: entryId },
    data: { clockState: "RUNNING", breakStartedAt: null },
  });
  await database().vehicleAssignment.update({
    where: { id: assignmentId },
    data: { endAt: new Date() },
  });
  await expect(submitInspection(driver, form())).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    submitInspection(driver, change(form(), { entryId: randomUUID() })),
  ).rejects.toMatchObject({ status: 404 });
});
it("same key with different metadata conflicts and one inspection per shift assignment", async () => {
  const f = form();
  await submitInspection(driver, f);
  await expect(
    submitInspection(driver, change(f, { odometerKm: 1 })),
  ).rejects.toMatchObject({ status: 409 });
  await expect(submitInspection(driver, form())).rejects.toMatchObject({
    status: 409,
  });
});
it("exact retry still works after shift and assignment end", async () => {
  const f = form();
  const r = await submitInspection(driver, f);
  await database().workTimeEntry.update({
    where: { id: entryId },
    data: { endAt: new Date(), clockState: "FINISHED", status: "SUBMITTED" },
  });
  await database().vehicleAssignment.update({
    where: { id: assignmentId },
    data: { endAt: new Date() },
  });
  expect(await submitInspection(driver, f)).toEqual(r);
});
it("live membership revocation and staff submission are denied", async () => {
  await expect(submitInspection(admin, form())).rejects.toMatchObject({
    status: 403,
  });
  await database().membership.update({
    where: { id: driver.userId + "-member" },
    data: { active: false },
  });
  await expect(submitInspection(driver, form())).rejects.toMatchObject({
    status: 403,
  });
  await expect(inspectionList(driver, 1)).rejects.toMatchObject({
    status: 403,
  });
  await database().membership.update({
    where: { id: driver.userId + "-member" },
    data: { active: true },
  });
});
it("submitted inspection, report metadata and photo links are immutable", async () => {
  const r = await submitInspection(driver, form());
  const row = await database().vehicleInspection.findUniqueOrThrow({
    where: { id: r.id },
  });
  await expect(
    engine.query('UPDATE "VehicleInspection" SET "odometerKm"=1 WHERE id=$1', [
      r.id,
    ]),
  ).rejects.toThrow();
  await expect(
    engine.query('DELETE FROM "VehicleInspection" WHERE id=$1', [r.id]),
  ).rejects.toThrow();
  await expect(
    engine.query(
      "UPDATE \"VehiclePhotoReport\" SET notes='changed' WHERE id=$1",
      [row.reportId],
    ),
  ).rejects.toThrow();
  await expect(
    engine.query('DELETE FROM "VehiclePhoto" WHERE "reportId"=$1', [
      row.reportId,
    ]),
  ).rejects.toThrow();
  expect((await inspectionList(admin, 1)).items.length).toBeGreaterThan(0);
});
it("peer and foreign-tenant readers cannot list or download another driver's evidence", async () => {
  const r = await submitInspection(driver, form());
  const object = (await inspectionList(driver, 1)).items.find(
    (x) => x.id === r.id,
  )!.report.files[0].objectId;
  const db = database();
  const peer: Principal = {
    ...driver,
    userId: "inspection-peer",
    driverId: "inspection-peer-profile",
    email: "peer@inspection.test",
  };
  await db.user.create({
    data: { id: peer.userId, email: peer.email, name: "Peer" },
  });
  await db.membership.create({
    data: {
      id: "peer-member",
      userId: peer.userId,
      organizationId: peer.organizationId,
      role: "DRIVER",
    },
  });
  await db.driverProfile.create({
    data: {
      id: peer.driverId!,
      organizationId: peer.organizationId,
      membershipId: "peer-member",
      firstName: "Peer",
      lastName: "Driver",
      email: peer.email,
    },
  });
  expect((await inspectionList(peer, 1)).items).toEqual([]);
  await expect(download(peer, object)).rejects.toMatchObject({ status: 404 });
  await expect(submitInspection(peer, form())).rejects.toMatchObject({
    status: 404,
  });
  const foreign: Principal = { ...admin, organizationId: "inspection-other" };
  await db.organization.create({
    data: { id: foreign.organizationId, name: "Other" },
  });
  await db.membership.create({
    data: {
      userId: foreign.userId,
      organizationId: foreign.organizationId,
      role: "ADMIN",
    },
  });
  expect((await inspectionList(foreign, 1)).items).toEqual([]);
  await expect(download(foreign, object)).rejects.toMatchObject({
    status: 404,
  });
});
it("invalid images and PDF bytes cannot create inspection records", async () => {
  const f = form();
  f.set(
    "front",
    new File([new Uint8Array([255, 216, 255, 0, 1])], "broken.jpg", {
      type: "image/jpeg",
    }),
  );
  await expect(submitInspection(driver, f)).rejects.toMatchObject({
    status: 422,
  });
  const pdf = form();
  pdf.set(
    "front",
    new File(["%PDF-1.7"], "front.pdf", { type: "application/pdf" }),
  );
  await expect(submitInspection(driver, pdf)).rejects.toMatchObject({
    status: 422,
  });
  expect(await database().vehicleInspection.count({ where: { entryId } })).toBe(
    0,
  );
});
it("photo contents are part of replay identity", async () => {
  const f = form();
  await submitInspection(driver, f);
  f.set(
    "front",
    new File([new Uint8Array(images[4])], "front.png", { type: "image/png" }),
  );
  await expect(submitInspection(driver, f)).rejects.toMatchObject({
    status: 409,
  });
});
it("renaming the same photo does not bypass duplicate view detection", async () => {
  const f = form();
  f.set(
    "rear",
    new File([new Uint8Array(images[0])], "different.png", {
      type: "image/png",
    }),
  );
  await expect(submitInspection(driver, f)).rejects.toMatchObject({
    status: 422,
  });
});
it("an inactive vehicle cannot receive a new inspection", async () => {
  await database().vehicle.update({
    where: { id: "inspection-car" },
    data: { status: "INACTIVE" },
  });
  try {
    await expect(submitInspection(driver, form())).rejects.toMatchObject({
      status: 409,
    });
  } finally {
    await database().vehicle.update({
      where: { id: "inspection-car" },
      data: { status: "ACTIVE" },
    });
  }
});
it("ended assignments keep their author's evidence private and available", async () => {
  const r = await submitInspection(driver, form());
  await database().vehicleAssignment.update({
    where: { id: assignmentId },
    data: { endAt: new Date() },
  });
  const row = (await inspectionList(driver, 1)).items.find(
    (x) => x.id === r.id,
  )!;
  const content = await download(driver, row.report.files[0].objectId);
  const metadata = await sharp(content.bytes).metadata();
  expect(metadata.format).toBe("jpeg");
  expect(metadata.exif).toBeUndefined();
  expect(
    (await download(admin, row.report.files[0].objectId)).bytes.length,
  ).toBeGreaterThan(0);
});
it("rechecks assignment after image storage and removes uncommitted files", async () => {
  const original = storage.storeBytes;
  const keys: string[] = [];
  const spy = vi
    .spyOn(storage, "storeBytes")
    .mockImplementation(async (bytes, mime) => {
      const key = await original(bytes, mime);
      keys.push(key);
      if (keys.length === 1)
        await database().vehicleAssignment.update({
          where: { id: assignmentId },
          data: { endAt: new Date() },
        });
      return key;
    });
  try {
    await expect(submitInspection(driver, form())).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await database().vehicleInspection.count({ where: { entryId } }),
    ).toBe(0);
    for (const key of keys)
      await expect(readFile(`.data/files/${key}`)).rejects.toMatchObject({
        code: "ENOENT",
      });
  } finally {
    spy.mockRestore();
  }
});
it("storage failure leaves no inspection or uploaded prefix behind", async () => {
  const original = storage.storeBytes;
  let key = "";
  const spy = vi
    .spyOn(storage, "storeBytes")
    .mockImplementation(async (bytes, mime) => {
      if (key) throw new Error("storage unavailable");
      const created = await original(bytes, mime);
      key = created;
      return created;
    });
  try {
    await expect(submitInspection(driver, form())).rejects.toThrow(
      "storage unavailable",
    );
    expect(
      await database().vehicleInspection.count({ where: { entryId } }),
    ).toBe(0);
    await expect(readFile(`.data/files/${key}`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    spy.mockRestore();
  }
});
it("pinned stored-object metadata cannot redirect inspection evidence", async () => {
  const r = await submitInspection(driver, form());
  const object = (await inspectionList(driver, 1)).items.find(
    (x) => x.id === r.id,
  )!.report.files[0].objectId;
  await expect(
    engine.query(
      "UPDATE \"StoredObject\" SET key='replacement-key' WHERE id=$1",
      [object],
    ),
  ).rejects.toThrow();
});
it("ambiguous transaction failure retains bytes for safe retry and reconciliation", async () => {
  const db = database();
  const transact = db.$transaction.bind(db);
  const original = storage.storeBytes;
  const keys: string[] = [];
  const files = vi
    .spyOn(storage, "storeBytes")
    .mockImplementation(async (bytes, mime) => {
      const key = await original(bytes, mime);
      keys.push(key);
      return key;
    });
  const transactions = vi
    .spyOn(db, "$transaction")
    .mockImplementationOnce(transact)
    .mockRejectedValueOnce(new Error("ambiguous transaction outcome"));
  try {
    await expect(submitInspection(driver, form())).rejects.toThrow(
      "ambiguous transaction outcome",
    );
    expect(keys).toHaveLength(4);
    for (const key of keys)
      expect((await readFile(`.data/files/${key}`)).length).toBeGreaterThan(0);
  } finally {
    transactions.mockRestore();
    files.mockRestore();
    for (const key of keys) await storage.removeBytes(key);
  }
});
