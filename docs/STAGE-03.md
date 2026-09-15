# Stage 3 — Staff invitations

Version 0.1.3. Implemented for user acceptance; production qualification remains open.

## Delivered

Administrators have an **Einladungen** navigation item with search, pagination, delivery status, creation, resend and revocation. Invitations expire after 72 hours. Resending rotates the link, extends validity and requires a 60-second interval. Accepted or revoked invitations cannot be resent. An expired pending invitation can be resent; otherwise revoke it before creating another for the same email.

Administrators can invite drivers and dispatchers. Only a super administrator can invite an administrator. Invitations cannot grant super-administrator privileges. The inviter's active membership and role are checked again at acceptance; a resend uses the resending administrator as the current authorization sponsor.

Driver invitations use the name/email of an existing active driver without an account. The driver picker filters out inactive and already linked profiles. Acceptance links the new account to that profile, preserving fleet history. Dispatcher/admin invitations take a name and email. Existing accounts are rejected; this flow never resets somebody else's password or adds ambiguous access to a second organization. Existing-account administration remains Stage 4.

The acceptance page displays the organization, role and invited identity, checks password confirmation and creates the User, credential Account and Membership in one transaction. It then sends the user to normal login. Administrator MFA requirements still apply in production.

## Upgrade your local installation

Unlike Stages 1–2, this stage needs an additive database migration. It creates the invitation table and its indexes/constraints; it does not reset or reseed fleet data. Keep a backup of any data you need and retain your previous source copy.

1. Stop the existing development server.
2. Extract the new full-source archive into a new folder and copy your existing `.env`. Preserve unrelated local source changes if merging.
3. For local testing without email, add this line to `.env`:

```dotenv
INVITATION_DELIVERY=manual
```

4. Keep `BETTER_AUTH_URL` aligned with the URL you use in the browser (normally `http://localhost:3000`).
5. From the new project folder, run:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Do not run database reset or seed commands. If migration fails, stop and share the error without credentials rather than deleting tables.

## Local acceptance test

1. Sign in as your administrator and open **Einladungen → Mitarbeiter einladen**.
2. Choose **Disponent**, use an unused test email such as `dispatcher-test@example.test`, and enter a name. In manual mode no email is sent; a local test link appears once. Copy it before leaving the screen.
3. Open the link in a private/incognito window. Confirm the organization and role, choose a password of at least 12 characters, repeat it and create the account.
4. Sign in with that email/password. Verify dispatcher access; **Einladungen** must not be available to the dispatcher.
5. Return to your admin window and refresh. The invitation must show **Angenommen**. Reopening its original link must fail.
6. Create another invitation, wait at least 60 seconds, then choose **Erneut senden**. Only the new link should work. Revoke it and confirm that link stops working too.
7. Create a test driver profile without an account. Invite it with role **Fahrer**. The acceptance identity must match the profile; login must access that driver's own records. The process must not create a duplicate driver profile.
8. Check search, result-page buttons, narrow mobile layout, dark mode and dialog transitions. Reduced motion disables the added animation.

A link's fragment is removed from the address bar once preview succeeds. Reloading that page requires reopening the original copied link. Tokens are not stored in browser storage. Expiry is covered in automated tests; you do not need to wait 72 hours or edit database records to test it manually.

Manual mode is explicitly forbidden in production, and manually issued invitations cannot be accepted there. Manual test acceptance does not mark the email address as verified.

## Email configuration

For email mode, set `INVITATION_DELIVERY=email` (also the default). Configure the existing private `AUTH_EMAIL_WEBHOOK_URL` and `AUTH_EMAIL_WEBHOOK_TOKEN`. Production requires HTTPS for the application and webhook, plus a webhook token. No new email provider subscription is configured by this source package.

The webhook now needs to support both the existing `password-reset` template and this request:

```json
{
  "to": "person@example.test",
  "template": "staff-invitation",
  "url": "https://your-fahriva-host/invite#<single-use-token>",
  "name": "Invited Person",
  "organization": "Your Fleet",
  "role": "DISPATCHER",
  "expiresAt": "<ISO UTC timestamp>",
  "invitationId": "<invitation identifier>"
}
```

Requests carry `Authorization: Bearer <AUTH_EMAIL_WEBHOOK_TOKEN>`. The receiving service renders and sends the message. Escape name/organization fields in HTML templates, preserve the entire URL including its fragment, and avoid logging the token-bearing payload. Return a successful HTTP status only after accepting responsibility for sending.

**An E-Mail-Dienst übergeben** means the webhook accepted the request, not that an inbox received it. Failure/timeout is shown as **Versand nicht bestätigt**. The saved invitation remains pending; resend rotates the link. There is no automatic retry queue in this stage. Test the real delivery provider, link rewriting, spam handling and password-reset compatibility before live use. No emails to real people were sent during development.

## API and security notes

- Administrator API: `GET/POST /api/v1/invitations`; create, resend and revoke actions. Organization and permissions come from the live session.
- Public API: `POST /api/invitations`, with action `preview` or `accept`. Accept takes a token and password; organization/role are never supplied by the invitee.
- Token entropy: 32 random bytes. Only SHA-256 digests are stored. No token or password appears in list responses or audit rows.
- Links use URL fragments rather than query parameters to keep tokens out of normal request URLs and Referer headers. Request-body logging must still be disabled/redacted at the deployment layer.
- Same-origin checks, bounded request bodies and public/global per-minute rate limits apply. Global acceptance budget is 30/minute; preview is 300/minute; each token/action is limited to 15/minute. Tune only after measured deployment load.
- Invitation and driver row locks prevent duplicate acceptance and stale driver linkage; credential creation, membership linkage, token consumption and audit writes commit together. Concurrent requests were tested with PGlite's single-connection adapter; native PostgreSQL race qualification remains a production gate.
- `npm run jobs:expiry` also cleans old invitation rate-limit buckets. Schedule that existing maintenance command as described in operations documentation.

## Verification boundaries

Automated tests cover token hashing/scoping, single use, rotation, revocation, expiry, driver linkage/rechecks, existing-account protection, role grants, issuer revocation, production MFA, local webhook success/failure and additive migration preservation. Real Better Auth sign-in was exercised after account acceptance.

Browser/mobile interaction, visual fidelity, live inbox delivery and native PostgreSQL concurrency are still acceptance/release checks. See `STAGE-03-VERIFICATION.md` for the executed results. Test this stage before starting Stage 4: existing-account and role administration.
