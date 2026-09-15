# Stage 16 — Reliable operational notifications

Version 0.1.16 extends **Benachrichtigungen → Nächste Schritte**. Stages 14–15 remain deferred until representative score/PHR/concessions reports are supplied.

## Workflow

Reading, acknowledgement and completion are separate. The recipient is initially responsible. Staff can assign an active administrator/dispatcher a next action and optional Berlin deadline. The assigned owner then sees the original record in their inbox and must acknowledge it. The original recipient retains access. Assignment resets the shared read/acknowledgement state and starts a new reminder cycle.

Only the current owner may acknowledge or complete. Completion requires an outcome and resolves linked reminder records. Stock alerts resolve only when inventory reaches its minimum; acknowledging a stock alert does not claim that stock has recovered. Names reflect current membership records, and workflow changes are audited.

New notifications plan one in-app reminder after 24 hours. Generic acknowledgement cancels that reminder. An assigned action retains its reminder until completion, due at the chosen time or after 24 hours when no date is set. Reminder creation is atomic and does not create recursive reminders. Reassigning an action can start another reminder cycle; earlier messages remain historical records.

If the responsible recipient is unavailable, the job retries with 5/10/20/40-minute waits, then displays **Handlungsbedarf** after five failures. Correct the recipient/access problem and use **Erinnerung erneut einplanen**. A reminder created in the inbox is not proof of human receipt. Driver sessions cannot access staff-only or stock notifications after demotion.

## Upgrade and scheduling

Back up the operational database using your established procedure. Preserve environment settings, install dependencies, stop the old app, run `npm run db:migrate`, then `npm run build` and restart. The additive migration is `20260919_notification_workflow`. Do not reset or reseed the operational database.

The migration preserves existing notification/read/resolution records and leaves their reminder schedules empty. It does not suddenly remind users about old messages. Old messages can enter the workflow when a next action is explicitly assigned.

Schedule `npm run jobs:reminders` from the deployed project directory, for example every five minutes, with the deployment's Node runtime and environment. Retain the existing expiry and stock jobs. The reminder job exits nonzero on unexpected database errors; schedule retries and monitor failures in deployment. No job schedule, external delivery service or production deployment was configured here. No real-user messages were sent during development.

## Browser test checklist

1. Open a notification's **Nächste Schritte**. Confirm reading differs from **Übernahme bestätigen**. Acknowledge, enter an outcome and complete a non-stock notification.
2. Assign a staff owner, next action and deadline. Sign in as that owner and verify inbox access. The original recipient must not acknowledge on their behalf.
3. Use stale tabs to attempt conflicting assignment/completion changes; verify a refresh is required. Confirm unrelated users cannot access the record.
4. In disposable test data, make a reminder due and run `npm run jobs:reminders` repeatedly/concurrently. Verify one reminder record and no recursive reminders. Use **Ursprungsmeldung öffnen**.
5. Make the recipient unavailable in test data. Verify retry scheduling and eventual visible failure, then restore access and explicitly retry. No external messages should be sent.
6. Acknowledge a generic notification before its reminder is due; verify cancellation. Acknowledge an assigned action and verify its due reminder is retained until completion.
7. Confirm stock alerts remain open until stock recovery, and stock/staff-only records are hidden from driver-role sessions.
8. Verify old messages remain unscheduled after migration. Test keyboard focus, Escape, mobile scrolling, errors and reduced-motion transitions.

See `STAGE-16-VERIFICATION.md` for automated evidence. Next is Stage 17 (audit/security investigation). Twenty-five stages remain, including deferred stages 14–15 and twelve optional extensions.
