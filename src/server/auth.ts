import { sendAuthEmail } from "./email";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { headers } from "next/headers";
import { database } from "./db";
import { AppError, type Principal } from "./policy";
let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
  const url = process.env.BETTER_AUTH_URL;
  if (!url || !process.env.BETTER_AUTH_SECRET)
    throw new Error("Authentication configuration is missing");
  if (
    process.env.BETTER_AUTH_SECRET.length < 32 ||
    process.env.BETTER_AUTH_SECRET.startsWith("replace-")
  )
    throw new Error("Set a strong private authentication secret");
  if (
    process.env.NODE_ENV === "production" &&
    new URL(url).protocol !== "https:"
  )
    throw new Error("Production authentication requires HTTPS");
  return betterAuth({
    baseURL: url,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(database(), { provider: "postgresql" }),
    trustedOrigins: [url],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url: resetUrl }) => {
        await sendAuthEmail({
          to: user.email,
          template: "password-reset",
          url: resetUrl,
        });
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => ({
            data: {
              ...session,
              mfaVerified:
                context?.path === "/two-factor/verify-totp" ||
                context?.path === "/two-factor/verify-backup-code",
            },
          }),
        },
      },
      user: {
        update: {
          after: async (user, context) => {
            // The plugin creates the replacement session after this hook. Revoke every
            // pre-enrollment session, including sessions opened on another device.
            if (
              context?.path === "/two-factor/verify-totp" ||
              context?.path === "/two-factor/disable"
            )
              await database().session.deleteMany({
                where: { userId: user.id },
              });
          },
        },
      },
    },
    session: {
      additionalFields: {
        mfaVerified: { type: "boolean", defaultValue: false, input: false },
      },
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 30,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    plugins: [twoFactor({ issuer: "Fahriva" })],
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
  });
}
export function auth() {
  return (instance ??= createAuth());
}
/** A database lookup on every request makes membership revocation effective immediately. */
export async function principalFromHeaders(h: Headers): Promise<Principal> {
  const session = await auth().api.getSession({ headers: h });
  if (!session) throw new AppError(401, "Bitte zuerst anmelden.");
  const memberships = await database().membership.findMany({
    where: { userId: session.user.id, active: true },
    include: { organization: true, driver: true },
    take: 2,
  });
  if (memberships.length !== 1)
    throw new AppError(403, "Kein eindeutiger Organisationszugang vorhanden.");
  const m = memberships[0];
  if (!["SUPER_ADMIN", "ADMIN", "DISPATCHER", "DRIVER"].includes(m.role))
    throw new AppError(403, "Ungültige Rolle.");
  if (m.role === "DRIVER" && m.driver?.status !== "ACTIVE")
    throw new AppError(403, "Der Fahrerzugang ist inaktiv.");
  if (
    process.env.NODE_ENV === "production" &&
    ["SUPER_ADMIN", "ADMIN"].includes(m.role) &&
    (!session.user.twoFactorEnabled || !session.session.mfaVerified)
  )
    throw new AppError(
      403,
      "Bitte die Zwei-Faktor-Anmeldung im Konto aktivieren.",
    );
  return {
    userId: m.userId,
    organizationId: m.organizationId,
    role: m.role as Principal["role"],
    driverId: m.driver?.id ?? null,
    name: session.user.name,
    email: session.user.email,
    organizationName: m.organization.name,
  };
}
export async function requirePrincipal() {
  return principalFromHeaders(await headers());
}
