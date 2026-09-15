# Stage 13 — Low-stock alerts

Version 0.1.13 adds **Inventar → Bestandswarnung**. Set the minimum and choose an active administrator or dispatcher responsible for the item. You may choose yourself. Alerts appear under **Benachrichtigungen** and link back to inventory.

## Behavior

- Available stock strictly below the minimum triggers one alert per shortage episode and responsible person. At equality, stock is sufficient. Minimum 0 never triggers an alert.
- Saving settings while already below minimum evaluates immediately. Adjustments, custody issues/returns and threshold edits also evaluate inside their stock transaction.
- Rechecks preserve the alert and its read state. Recovery to the minimum or above marks open alerts as resolved. A later shortage starts a new episode.
- Changing the responsible person during a shortage sends at most one alert to the new person for that episode. Returning to a previously notified person does not send another. Earlier notifications remain visible to eligible staff and are resolved on recovery.
- Disabling notifications stops new alerts; existing notifications remain historical records until stock recovery resolves them. An unavailable recipient receives no new notification, and inventory shows that configuration problem.
- Periodic reconciliation can deliver a previously suppressed alert when its recipient becomes eligible again. Driver sessions cannot read staff stock notifications after a role change.

These are in-app notifications. No emails or push messages are sent. Reading an alert and resolving a shortage are separate states. Notification text records stock at trigger time; follow its inventory link for current values.

## Upgrade and scheduling

Back up your database using your established procedure. Preserve local environment settings, install dependencies, stop the old app, run `npm run db:migrate`, then `npm run build` and restart. The additive migration is `20260918_stock_alerts`. Do not reset or reseed the operational database.

The migration preserves existing stock and notifications, initializes shortage state, and leaves recipients unset. Configure alerts for the items you want monitored. It sends no notifications during migration.

Schedule `npm run jobs:stock` from the project directory with the deployed environment, for example every five minutes. The command must use the deployment's Node runtime and database credentials. It is safe to retry; failed runs exit with an error. Scheduling and monitoring are deployment responsibilities and have not been configured here. Immediate alert checks still run on app stock writes without that schedule.

## Browser test checklist

1. Choose a responsible staff member in **Bestandswarnung**, including self-selection. Confirm minimum and status after reopening.
2. Reduce available stock below minimum using an adjustment or custody issue. Confirm one alert with item/SKU and trigger-time stock.
3. Run `npm run jobs:stock` repeatedly in your test environment and make further below-minimum changes. Confirm no duplicate. Read the alert and verify rechecks keep it read.
4. Return/restock up to the minimum. Confirm the alert is resolved. Reduce stock again and verify a new alert appears.
5. Configure an already-low item and change its recipient. Confirm one alert per eligible person per episode. Try minimum 0 and disabled notifications.
6. Deactivate the recipient in test data, verify inventory reports unavailable, then reactivate and reconcile. Test a stale settings tab and an old threshold edit; they must not overwrite newer settings.
7. Confirm driver-role sessions cannot read these alerts. Use the notification's inventory link to check current stock.
8. Test keyboard focus, dialog dismissal, loading/errors, mobile scrolling and reduced motion inherited from the main interface.

See `STAGE-13-VERIFICATION.md` for automated evidence. Stage 14 (versioned score definitions and adapters) has not started. There are 26 stages left, including 12 optional extensions.
