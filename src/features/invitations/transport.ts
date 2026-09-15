import { emailConfiguration, sendAuthEmail } from "../../server/email";
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
  const endpoint = manual ? undefined : emailConfiguration().endpoint;
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
    await sendAuthEmail({
      to: invitation.email,
      template: "staff-invitation",
      url,
      name: invitation.name,
      organization,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      invitationId: invitation.id,
    });
    return { delivery: "SENT" };
  } catch {
    return { delivery: "FAILED" };
  }
}
