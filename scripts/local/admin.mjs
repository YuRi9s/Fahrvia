import { client } from "./database.mjs";
import { connectionUrl, requireThat } from "./core.mjs";
import { ask, password } from "./prompt.mjs";
import { run } from "./process.mjs";
export async function ensureAdmin(c, mayCreate) {
  const db = await client(c);
  let exists;
  try {
    exists =
      (
        await db.query(
          `SELECT count(*)::int AS n FROM "Membership" WHERE role='SUPER_ADMIN'`,
        )
      ).rows[0].n > 0;
  } finally {
    await db.end();
  }
  if (exists) return "existing SUPER_ADMIN preserved (no account changed)";
  requireThat(
    mayCreate,
    "No SUPER_ADMIN exists. Run npm run local:bootstrap to securely provision one.",
  );
  const email =
    process.env.SEED_ADMIN_EMAIL?.trim() ||
    (await ask("Administrator email: "));
  const organization =
    process.env.SEED_ORGANIZATION?.trim() || (await ask("Organization name: "));
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Administrator";
  const secret =
    process.env.SEED_ADMIN_PASSWORD ||
    (await password("Administrator password (16+ characters, hidden): "));
  requireThat(
    email.includes("@") && secret.length >= 16 && organization,
    "Provide email, organization and a password of at least 16 characters. No default account was created.",
  );
  if (!process.env.SEED_ADMIN_PASSWORD)
    requireThat(
      (await password("Repeat password: ")) === secret,
      "Passwords do not match.",
    );
  await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
    env: {
      DATABASE_URL: connectionUrl(c, "runtime"),
      SEED_ADMIN_EMAIL: email,
      SEED_ADMIN_PASSWORD: secret,
      SEED_ADMIN_NAME: name,
      SEED_ORGANIZATION: organization,
    },
    label:
      "One-time administrator provisioning (existing email accounts are never overwritten)",
  });
  return "SUPER_ADMIN created; enroll MFA after sign-in";
}
