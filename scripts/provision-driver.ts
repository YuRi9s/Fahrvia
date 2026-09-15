/** Operator command: links an existing driver to a password account in the same organization. */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { database } from "../src/server/db";
const driverId = process.env.PROVISION_DRIVER_ID;
const password = process.env.PROVISION_PASSWORD;
const actorEmail = process.env.PROVISION_ADMIN_EMAIL?.toLowerCase();
if (!driverId || !password || password.length < 16 || !actorEmail)
  throw new Error(
    "Set PROVISION_DRIVER_ID, PROVISION_PASSWORD (16+ characters), and PROVISION_ADMIN_EMAIL.",
  );
const db = database();
try {
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${driverId} FOR UPDATE`;
    const driver = await tx.driverProfile.findUniqueOrThrow({
      where: { id: driverId },
    });
    if (driver.membershipId || driver.status !== "ACTIVE")
      throw new Error("Driver must be active and have no account.");
    const actor = await tx.membership.findFirst({
      where: {
        organizationId: driver.organizationId,
        active: true,
        role: { in: ["ADMIN", "SUPER_ADMIN"] },
        user: { email: actorEmail },
      },
    });
    if (!actor)
      throw new Error(
        "Active administrator in the same organization required.",
      );
    const userId = randomUUID();
    await tx.user.create({
      data: {
        id: userId,
        name: `${driver.firstName} ${driver.lastName}`,
        email: driver.email.toLowerCase(),
        emailVerified: false,
      },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: passwordHash,
      },
    });
    const membership = await tx.membership.create({
      data: { userId, organizationId: driver.organizationId, role: "DRIVER" },
    });
    await tx.driverProfile.update({
      where: { id: driverId },
      data: { membershipId: membership.id },
    });
    await tx.auditLog.create({
      data: {
        organizationId: driver.organizationId,
        actorId: actor.userId,
        action: "provision-driver",
        resourceType: "driver",
        resourceId: driverId,
      },
    });
  });
  console.log(
    "Driver account created. Distribute the password through your approved private channel.",
  );
} finally {
  await db.$disconnect();
}
