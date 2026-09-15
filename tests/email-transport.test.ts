import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import {
  deliverInvitation,
  invitationTransport,
} from "../src/features/invitations/transport";
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
  servers.length = 0;
});
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return `http://127.0.0.1:${address.port}`;
}
function setup(endpoint: string) {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("INVITATION_DELIVERY", "email");
  vi.stubEnv("AUTH_EMAIL_WEBHOOK_URL", endpoint);
}
const invitation = {
  id: "inv-1",
  email: "test@example.test",
  name: "Test",
  role: "DRIVER",
  expiresAt: new Date("2026-10-01"),
};
it("does not forward invitation tokens through webhook redirects", async () => {
  let forwarded = 0;
  const target = await serve((_req, res) => {
    forwarded++;
    res.end();
  });
  const endpoint = await serve((_req, res) => {
    res.writeHead(307, { Location: target });
    res.end();
  });
  setup(endpoint);
  const result = await deliverInvitation(
    invitationTransport(),
    "secret-token",
    invitation,
    "Fleet",
  );
  expect(result.delivery).toBe("FAILED");
  expect(forwarded).toBe(0);
});
it.each([
  "ftp://mail.test",
  "http://user:secret@mail.test",
  "http://mail.test/#secret",
])("rejects unsafe endpoint %s", (endpoint) => {
  setup(endpoint);
  expect(() => invitationTransport()).toThrow();
});

it("accepts both templates with their original payload and private authentication", async () => {
  const { sendAuthEmail } = await import("../src/server/email");
  const received: unknown[] = [];
  const endpoint = await serve(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    res.writeHead(202);
    res.end();
  });
  setup(endpoint);
  vi.stubEnv("AUTH_EMAIL_WEBHOOK_TOKEN", "private-test");
  const reset = {
    to: "test@example.test",
    template: "password-reset" as const,
    url: "http://localhost:3000/api/auth/reset-password/test-token?callbackURL=%2Freset-password",
  };
  await sendAuthEmail(reset);
  const result = await deliverInvitation(
    invitationTransport(),
    "invite-token",
    invitation,
    "Fleet",
  );
  expect(result.delivery).toBe("SENT");
  expect(received).toEqual([
    { authorization: "Bearer private-test", body: reset },
    {
      authorization: "Bearer private-test",
      body: {
        to: invitation.email,
        template: "staff-invitation",
        url: "http://localhost:3000/invite#invite-token",
        name: "Test",
        organization: "Fleet",
        role: "DRIVER",
        expiresAt: invitation.expiresAt.toISOString(),
        invitationId: "inv-1",
      },
    },
  ]);
});
it("rejects foreign recovery links before contacting the service", async () => {
  const { sendAuthEmail } = await import("../src/server/email");
  let calls = 0;
  setup(
    await serve((_req, res) => {
      calls++;
      res.end();
    }),
  );
  await expect(
    sendAuthEmail({
      to: "test@example.test",
      template: "password-reset",
      url: "https://foreign.test/api/auth/reset-password/token",
    }),
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(0);
});
it("redacts transport errors and rejects non-success responses", async () => {
  const { sendAuthEmail } = await import("../src/server/email");
  setup(
    await serve((_req, res) => {
      res.writeHead(503);
      res.end("private-provider-error");
    }),
  );
  await expect(
    sendAuthEmail({
      to: "test@example.test",
      template: "password-reset",
      url: "http://localhost:3000/api/auth/reset-password/token",
    }),
  ).rejects.toThrow("Der E-Mail-Versand ist derzeit nicht verfügbar.");
});
it("requires HTTPS and a nonblank token in production", async () => {
  const { emailConfiguration } = await import("../src/server/email");
  const env = {
    NODE_ENV: "production",
    BETTER_AUTH_URL: "https://fleet.test",
    AUTH_EMAIL_WEBHOOK_URL: "https://mail.test/send",
    AUTH_EMAIL_WEBHOOK_TOKEN: "private-token",
  };
  expect(emailConfiguration(env).origin).toBe("https://fleet.test");
  for (const change of [
    { AUTH_EMAIL_WEBHOOK_TOKEN: " " },
    { AUTH_EMAIL_WEBHOOK_URL: "http://mail.test" },
    { BETTER_AUTH_URL: "https://fleet.test/subpath" },
  ]) {
    expect(() => emailConfiguration({ ...env, ...change })).toThrow();
  }
});
