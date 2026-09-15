# Stage 4 — Accounts and roles

Version 0.1.4 adds **Konten & Rollen** to the existing German workspace. This handoff contains one stage. Driver profile reactivation follows in Stage 5.

## Upgrade an existing installation

Keep your existing `.env`, database and private files. Back up the database using your normal operational procedure. Replace the application source, then run:

```sh
npm ci --ignore-scripts --omit=peer
npm run db:generate
npm run db:migrate
npm run dev
```

The additive migration adds `Membership.version` and `Invitation.issuerVersion`, both initially 1. It does not delete records, create accounts or reset passwords. Do not rerun bootstrap/seed or reset your database. Production installations should build and restart using their established deployment procedure.

## Delivered behavior

- Search names/emails, paginate all accounts and filter active/disabled access.
- Manage roles and access in a confirmation dialog with a required reason and explicit before/after summary.
- Administrators manage driver/dispatcher accounts; super-administrators also manage administrators and grant ADMIN. Self changes and all super-administrator changes are blocked. These rules preserve an active administrator without relying on an unlocked count.
- Every successful change revokes all sessions for the target user, increments the membership version and writes an atomic audit record. A concurrent/stale edit must be reloaded.
- Open invitation links issued by the changed account become unusable, including after access restoration. The invitations screen marks them for resend. A currently authorized administrator can issue a replacement link.
- Driver links and operational history remain intact. DRIVER can only be selected for an already-linked profile; active driver access requires an active profile. Linking an existing non-driver account to a new driver profile is not part of this stage.
- An archived profile stays archived. A promoted driver can keep their staff role even if their old driver profile is archived. Disabling account access does not automatically return keys, close assignments or archive a profile.
- Dialog/backdrop entry, press feedback and success feedback respect reduced-motion settings.

## User test checklist

Use disposable staff accounts, keeping the bootstrap super-administrator signed in.

1. Open **Konten & Rollen**, search an account and try the access filters and pagination.
2. As super-administrator, change a dispatcher to administrator with a reason. Their existing signed-in browser should lose access on its next protected request and require a fresh login. Production administrator access still requires verified MFA.
3. Disable a staff account, confirm their access is denied, then restore it and verify a fresh login succeeds. Old sessions must stay invalid.
4. As an ordinary administrator, confirm administrators are protected and ADMIN cannot be granted. Confirm your own account and super-administrators cannot be changed.
5. Open the same account in two tabs. Save in one, then attempt a different change in the other. The second must report a stale edit; close the dialog, refresh and reopen.
6. Disable and restore an administrator who has a pending invitation. The old link must fail; **Einladungen** must mark it for resend. Resend as an authorized administrator and use the replacement link.
7. Verify a linked active driver can become dispatcher and return to DRIVER without changing profile history. An archived driver must not regain driver access through this screen.
8. Check narrow-screen table scrolling, keyboard focus, Escape/cancel, errors inside the dialog, busy buttons and reduced-motion preference.

Browser interactions and a deployed production environment have not been exercised here. Full v1 qualification remains tracked in `STAGES.md`.
