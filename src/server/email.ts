import { AppError } from "./policy";

type Environment = Record<string, string | undefined>;
const unavailable = () =>
  new AppError(503, "Der E-Mail-Versand ist derzeit nicht verfügbar.");
export function emailConfiguration(env: Environment = process.env) {
  try {
    const origin = new URL(env.BETTER_AUTH_URL || "");
    const endpoint = new URL(env.AUTH_EMAIL_WEBHOOK_URL || "");
    const production = env.NODE_ENV === "production";
    for (const url of [origin, endpoint]) {
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        (production && url.protocol !== "https:")
      )
        throw unavailable();
    }
    if (origin.pathname !== "/" || origin.search) throw unavailable();
    const token = env.AUTH_EMAIL_WEBHOOK_TOKEN || "";
    if ((production && !token.trim()) || /[\r\n]/.test(token))
      throw unavailable();
    return { origin: origin.origin, endpoint: endpoint.href, token };
  } catch {
    throw unavailable();
  }
}
export type AuthEmail =
  | { to: string; template: "password-reset"; url: string }
  | {
      to: string;
      template: "staff-invitation";
      url: string;
      name: string;
      organization: string;
      role: string;
      expiresAt: string;
      invitationId: string;
    };

/** A successful handoff is acceptance by the webhook, not proof of inbox delivery. */
export async function sendAuthEmail(message: AuthEmail) {
  const config = emailConfiguration();
  try {
    const link = new URL(message.url);
    if (link.origin !== config.origin || link.username || link.password)
      throw unavailable();
    if (
      message.template === "staff-invitation" &&
      (link.pathname !== "/invite" || !link.hash || link.search)
    )
      throw unavailable();
    if (
      message.template === "password-reset" &&
      !link.pathname.startsWith("/api/auth/reset-password/")
    )
      throw unavailable();
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(message),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    // The response body is not part of the contract; never log provider content.
    await response.body?.cancel();
    if (!response.ok) throw unavailable();
  } catch {
    throw unavailable();
  }
}
