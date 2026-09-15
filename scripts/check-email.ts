import { emailConfiguration } from "../src/server/email";

// Configuration-only: no messages, network requests, tokens or recipients in output.
try {
  emailConfiguration({ ...process.env, NODE_ENV: "production" });
  if (
    process.env.INVITATION_DELIVERY &&
    process.env.INVITATION_DELIVERY !== "email"
  )
    throw new Error("mode");
  console.log(
    JSON.stringify(
      {
        status: "CONFIGURATION_PASSED",
        delivery: "NOT_TESTED",
        message:
          "Production email configuration is structurally valid. Follow docs/STAGE-21.md for inbox and recovery acceptance.",
      },
      null,
      2,
    ),
  );
} catch {
  console.log(
    JSON.stringify(
      {
        status: "BLOCKED",
        delivery: "NOT_TESTED",
        message:
          "Set a canonical HTTPS BETTER_AUTH_URL, HTTPS AUTH_EMAIL_WEBHOOK_URL without embedded credentials or fragment, private AUTH_EMAIL_WEBHOOK_TOKEN, and INVITATION_DELIVERY=email. Configuration values are not printed.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
