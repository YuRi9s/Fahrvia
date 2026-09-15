# Stage 21 — Email integration

Version 0.1.21 consolidates invitation and password-recovery delivery into one private webhook transport. Live inbox qualification remains open. No database migration or new dependency is required.

## Install and check

Preserve your working configuration and any local startup fixes when applying the source update. Run `npm ci` and `npm run build`, then restart using your working deployment procedure.

Configure the existing email service using `.env`:

- `BETTER_AUTH_URL`: the exact public HTTPS origin, without a subpath, query or credentials.
- `AUTH_EMAIL_WEBHOOK_URL`: the final HTTPS endpoint of your private email service. Redirects are rejected. Embedded URL credentials and fragments are rejected.
- `AUTH_EMAIL_WEBHOOK_TOKEN`: the private bearer credential accepted by that service.
- `INVITATION_DELIVERY=email`.

Run:

```bash
npm run email:check
```

This is configuration-only. It sends no messages and prints no credentials or addresses. CONFIGURATION_PASSED means structurally valid settings, not a working service or inbox delivery. A local HTTP app can continue local testing, but this production check will report BLOCKED until HTTPS is configured.

## Webhook contract

The app posts JSON with `Authorization: Bearer <configured token>` and a ten-second timeout. The service must authenticate requests, validate the template, safely escape template fields, send or durably enqueue mail, and return a 2xx response only after accepting responsibility for delivery. The app ignores response bodies. It does not provide an SMTP server or an email-provider account.

Both templates include `to`, `template` and `url`:

| Template           | Additional fields                                                 | Link handling                                                                       |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `staff-invitation` | `name`, `organization`, `role`, `expiresAt` (ISO), `invitationId` | Preserve `/invite#token` exactly, including its fragment.                           |
| `password-reset`   | None                                                              | Preserve the supplied `/api/auth/reset-password/token?callbackURL=...` URL exactly. |

Use German subjects and body text, a clearly labelled action link, and a copyable fallback URL. Escape untrusted names and organisation text in HTML. Never replace the supplied link with a URL inferred from the recipient or request headers. Disable click tracking/link rewriting for these authentication links. Avoid logging message bodies or reset/invitation tokens.

The app accepts only authentication links on its configured origin. Transport failures have a generic error; provider response bodies are not exposed. Invitations retain existing SENT/FAILED states. SENT means webhook acceptance, not confirmed inbox delivery. There is no automatic retry here: an interrupted request may already have been accepted. Inspect provider status before resending; invitation resend rotates the token through the existing workflow.

## Acceptance on your deployment

Use only test accounts and mailboxes you control:

1. Invite a test staff member through the existing administrator screen. Verify the inbox message, German text, intended organisation/role and exact HTTPS origin. Accept it and sign in.
2. Resend a pending invitation. Verify the earlier link is invalid and the replacement works. Check cancellation and expiration using disposable invitations.
3. From the login recovery flow request a reset for an existing test account. Follow the email link, set a new password, verify the old password fails and the new password works. Check that existing sessions are revoked, and that reusing the reset link fails.
4. Request recovery for an unknown address. Check that the public response does not reveal account existence and no message is sent.
5. In a disposable environment, make the service return an error or redirect. Verify invitation delivery is FAILED, no production manual link appears, and no successful delivery is implied. Restore the endpoint and retry through the normal workflow.
6. Check spam placement and sender authentication using your provider's diagnostics. Verify the provider records bounces and delivery failures and an operator can respond to them. Webhook acceptance cannot establish these properties.

## What remains open

No real provider or mailbox was accessed during this stage. Sender setup, provider templates, inbox delivery, recovery browser behaviour and bounce handling require your infrastructure and acceptance results. Stages 19 and 20 retain their earlier open checks. The count remains 23 unqualified/deferred/optional stages; delivering this source does not close the production gates.
