# Stage 7 — Physical key lifecycle

Version 0.1.7. This handoff contains Stage 7 only; Stage 8 will add the weekly assignment board.

## Upgrade

Preserve `.env`, the database and private files. Back up the database using your normal operational process, replace the source, then run:

```sh
npm ci --ignore-scripts --omit=peer
npm run db:generate
npm run db:migrate
npm run dev
```

Production installations should build/restart through their established deployment procedure. Do not reset the database or rerun bootstrap.

The migration adds key status/version/replacement identity and event action/reason. Existing keys stay ACTIVE and retain their IDs, slots and custody records. The four-slot limit applies to active keys; retired records remain as history. Existing custody records are marked TRANSFER with their original time and an empty reason where none was recorded. The migration invents no past events.

## Delivered behavior

- **Schlüssel hinzufügen** registers a physical key on an active vehicle, in the first free slot from 1–4, initially at OFFICE.
- **Ersetzen** retires the selected key and creates a distinct replacement in the same slot. The replacement starts at OFFICE. Its history links to the previous key and vice versa.
- **Ausmustern** permanently retires a key. It remains searchable under status **Ausgemustert** and cannot be issued or changed again.
- Driver-held keys must first be returned or explicitly marked missing. A missing retired key remains marked MISSING; replacement does not pretend it was returned.
- Every custody/lifecycle change requires a reason and current version. Stale dialogs return a conflict. Receipt, transfers, retirement and replacement events are retained in append-only history.
- Administrators manage lifecycle; dispatchers manage custody and view history. Drivers cannot access the full staff custody history.
- Vehicle forms show the active key count as read-only on existing vehicles. Initial vehicle creation still allows 0–4 keys and now records their receipt.
- Dialog entry, backdrop, button feedback and success transitions reuse the existing reduced-motion-aware styles.

## User test checklist

Use a disposable active vehicle and staff accounts.

1. Open **Schlüsselmappe**, add a key with a reason and verify it appears at **Büro**. Add up to four active keys; a fifth must be refused.
2. Change custody to an active driver as dispatcher. Confirm retirement/replacement is unavailable while the driver holds it.
3. Return it to the office or mark it missing. Replace it and verify there is one active replacement plus a retired old record in the same slot.
4. Open **Verlauf** on both records. Follow the previous/replacement links and confirm earlier transfers remain visible. Check history pagination with more than 25 events.
5. Retire an office/missing key. Confirm its history remains and it cannot be transferred or retired twice. Add a fresh key to reuse the free active slot.
6. Open the same key in two tabs. Save a change in one, then submit the stale dialog in the other. Expect a conflict; close, refresh and reopen.
7. Verify inactive vehicles reject new/replacement keys and driver issuance. Existing keys can still be returned or retired.
8. Check administrator/dispatcher/driver permissions, narrow-screen tables, keyboard focus, cancel/Escape, busy/error states and reduced-motion preference.

No automatic driver assignment, password/access change or reopened vehicle assignment occurs. Browser/mobile and production environment acceptance remain pending. Automated results are in `STAGE-07-VERIFICATION.md`.
