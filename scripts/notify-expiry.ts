/** Schedule daily. Deterministic IDs make retries safe without repeated alerts. */
import { createHash } from "node:crypto";
import { database } from "../src/server/db";
const db = database();
const now = new Date();
const until = new Date(now.getTime() + 30 * 86400000);
try {
  const organizations = await db.organization.findMany({
    select: { id: true },
  });
  for (const org of organizations) {
    const members = await db.membership.findMany({
      where: { organizationId: org.id, active: true },
      include: { driver: { select: { id: true } } },
    });
    const docs = await db.document.findMany({
      where: {
        organizationId: org.id,
        archivedAt: null,
        expiresAt: { lte: until },
      },
      select: { id: true, title: true, driverId: true, expiresAt: true },
    });
    for (const doc of docs) {
      const stage = doc.expiresAt! < now ? "expired" : "expiring";
      const recipients = members.filter(
        (m) =>
          ["SUPER_ADMIN", "ADMIN"].includes(m.role) ||
          (m.role === "DRIVER" && m.driver?.id === doc.driverId),
      );
      for (const m of recipients) {
        const id = createHash("sha256")
          .update(
            `document:${doc.id}:${doc.expiresAt!.toISOString()}:${stage}:${m.userId}`,
          )
          .digest("hex");
        await db.notification.upsert({
          where: { id },
          update: {},
          create: {
            id,
            organizationId: org.id,
            recipientId: m.userId,
            staffOnly: m.role !== "DRIVER",
            title:
              stage === "expired"
                ? "Dokument abgelaufen"
                : "Dokument läuft bald ab",
            body: doc.title,
          },
        });
      }
    }
  }
  // Fixed-window mutation counters no longer serve a purpose after two hours.
  await db.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "mutation:" } },
        { key: { startsWith: "invitation:" } },
      ],
      lastRequest: { lt: BigInt(Date.now() - 2 * 3600000) },
    },
  });
  console.log("Expiry notifications processed.");
} finally {
  await db.$disconnect();
}
