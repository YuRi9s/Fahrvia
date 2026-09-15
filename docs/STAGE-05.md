# Stage 5 — Driver reactivation

Version 0.1.5. Only this stage is included; category lifecycle follows in Stage 6.

## Upgrade

Keep the existing `.env`, database and private files. Update the source and run your normal dependency/build/start procedure. This stage adds no database migration. If upgrading from before Stage 4, apply the included existing migrations with `npm run db:migrate`. Never reset the database or rerun bootstrap to upgrade.

```sh
npm ci --ignore-scripts --omit=peer
npm run db:generate
npm run dev
```

## Test checklist

1. Sign in as administrator and open **Fahrer**. Filter status to **Inaktiv**, then select **Reaktivieren** on an archived driver.
2. Check the name/email in the confirmation dialog, enter a reason and confirm. The driver should move to the active list with the same identity and historical records.
3. Verify closed vehicle assignments remain closed; no keys or vehicle assignments are issued automatically.
4. Verify the linked account remains disabled after restoring a driver archived through the app. To restore login, separately use **Konten & Rollen**. For an unlinked driver, use **Einladungen**.
5. Open the same inactive driver in two browser tabs. Reactivate in one; confirmation in the other should fail without adding another reactivation audit. Close, refresh and reopen after any stale-edit error.
6. Verify dispatchers and drivers cannot reactivate records. Cancel/Escape should make no changes; a blank reason should prevent submission.
7. Check dialog focus, narrow-screen layout, busy/error states, entry transitions and reduced-motion behavior.

The operation only changes the existing driver's status to ACTIVE. The audit stores actor, time, reason and before/after state. Suspensions, passwords, memberships and operational history are preserved. The dialog and success message make the separate account step explicit.

Automated verification is recorded in `STAGE-05-VERIFICATION.md`. Browser/mobile and deployment acceptance remain pending.
