/** Creates one administrator explicitly, without shipping a default password. */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { database } from "../src/server/db";
const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrator";
const organizationName = process.env.SEED_ORGANIZATION?.trim();
if (
  !email ||
  !email.includes("@") ||
  !password ||
  password.length < 16 ||
  !organizationName
)
  throw new Error(
    "Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (16+ characters), and SEED_ORGANIZATION.",
  );
const db = database();
try {
  if (await db.user.findUnique({ where: { email } }))
    throw new Error(
      "This email already exists. Seed never overwrites credentials.",
    );
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const userId = randomUUID();
    const org = await tx.organization.create({
      data: { name: organizationName },
    });
    await tx.user.create({
      data: { id: userId, name, email, emailVerified: true },
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
    await tx.membership.create({
      data: { userId, organizationId: org.id, role: "SUPER_ADMIN" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: userId,
        action: "bootstrap",
        resourceType: "organization",
        resourceId: org.id,
      },
    });
  });
  console.log(
    "Administrator created. Sign in and enroll two-factor authentication.",
  );
} finally {
  await db.$disconnect();
}
