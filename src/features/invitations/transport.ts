import { AppError } from "../../server/policy";

export function invitationTransport() {
  const base = process.env.BETTER_AUTH_URL;
  if (!base)
    throw new AppError(503, "Die Anwendungsadresse ist nicht konfiguriert.");
  const url = new URL(base);
  const manual = process.env.INVITATION_DELIVERY === "manual";
  if (
    process.env.NODE_ENV === "production" &&
    (manual || url.protocol !== "https:")
  )
    throw new AppError(
      503,
      "Einladungen benötigen in Produktion HTTPS und E-Mail-Versand.",
    );
  const endpoint = process.env.AUTH_EMAIL_WEBHOOK_URL;
  if (
    !manual &&
    (!endpoint ||
      (process.env.NODE_ENV === "production" &&
        (new URL(endpoint).protocol !== "https:" ||
          !process.env.AUTH_EMAIL_WEBHOOK_TOKEN)))
  )
    throw new AppError(
      503,
      "Bitte den E-Mail-Versand konfigurieren. Für lokale Tests ist INVITATION_DELIVERY=manual möglich.",
    );
  return {
    mode: manual ? ("MANUAL" as const) : ("EMAIL" as const),
    origin: url.origin,
    endpoint,
  };
}
export async function deliverInvitation(
  config: ReturnType<typeof invitationTransport>,
  token: string,
  invitation: {
    id: string;
    email: string;
    name: string;
    role: string;
    expiresAt: Date;
  },
  organization: string,
) {
  // Fragments are not sent in HTTP request URLs or Referer headers.
  const url = `${config.origin}/invite#${token}`;
  if (config.mode === "MANUAL") return { delivery: "MANUAL", localLink: url };
  try {
    const result = await fetch(config.endpoint!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AUTH_EMAIL_WEBHOOK_TOKEN ?? ""}`,
      },
      body: JSON.stringify({
        to: invitation.email,
        template: "staff-invitation",
        url,
        name: invitation.name,
        organization,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        invitationId: invitation.id,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return { delivery: result.ok ? "SENT" : "FAILED" };
  } catch {
    return { delivery: "FAILED" };
  }
}
