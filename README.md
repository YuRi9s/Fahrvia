# Fahriva

A German fleet operations application built with React and Next.js, backed by PostgreSQL. The interface and server share typed contracts; business records live in the database, while only the theme preference uses browser storage.

**Release status: 0.1.20, implementation checkpoint.** This is runnable application source. It is not yet the complete, production-certified Version 1.0 described in the master brief. Read `docs/RELEASE_STATUS.md` for implemented behavior and outstanding release gates.

## Run locally

Prerequisites: Node.js 24.20, npm, and PostgreSQL 18.6. Docker Compose can provide the database.

1. Copy `.env.example` to `.env`. Set the database URL, authentication URL and a strong random authentication secret. Use `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` to generate the secret locally.
2. If using Compose, set `POSTGRES_PASSWORD` in your environment, then run `docker compose up -d postgres`. Use that same password in `DATABASE_URL`.
3. Run `npm ci --ignore-scripts --omit=peer`, `npm run db:generate`, then `npm run db:migrate`.
4. In `.env`, set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (at least 16 characters), `SEED_ADMIN_NAME`, and `SEED_ORGANIZATION`. Run `npm run db:seed` once. Remove the bootstrap password afterward. The command refuses to overwrite an existing account.
5. Run `npm run dev`. Open `http://localhost:3000`, sign in with the account you created, and enroll MFA under **Profil → Kontosicherheit**.

Production administrators must complete MFA. Development keeps enrollment available without requiring it, so local setup does not lock you out. Public registration is disabled. No universal password or sign-in bypass is included.

Prisma 7 does not implicitly load `.env`; the migration and operator scripts explicitly load it with Node. `npm run build` needs no live database or production secrets.

## Supported workflows

- Drivers and vehicles; current assignments; individual keys and custody history; vehicle archive/reactivation with service periods.
- Weekly planning; waves with driver/vehicle references and validated status changes.
- Work-time creation, corrections, retained revisions and version-checked approval.
- Inventory stock changes with nonnegative stock enforcement and movement records.
- CSV/XLSX score preview, column mapping, validation, commit, source-file retention, history and rollback.
- Own-driver score and PHR/Concessions details by ISO week; manual detail corrections retain prior versions.
- Private document/photo uploads, explicitly driver-visible vehicle documents, renewals, expiration states and damage resolution.
- Participant-scoped conversations, unread counts, replies, notifications, operational reports and safe CSV export.

Creating a driver profile does not create a login automatically. Administrators can now invite an active driver through **Einladungen**; acceptance links the account to that driver. The operator command in `docs/OPERATIONS.md` remains available. Existing accounts are managed under **Konten & Rollen**. See `docs/STAGE-04.md` for the additive upgrade and test checklist.

Archived drivers can be restored under **Fahrer → Status: Inaktiv → Reaktivieren**. Account access stays separate. See `docs/STAGE-05.md`.

Category rename/archive/restore and linked vehicle brands/providers are available under **Kategorien**. Apply the Stage 6 migration and follow `docs/STAGE-06.md`.

Individual keys can be added, replaced or retired under **Schlüsselmappe**, with preserved custody history. Apply the Stage 7 migration and follow `docs/STAGE-07.md`.

## Project map

| Path                 | Responsibility                                                              |
| -------------------- | --------------------------------------------------------------------------- |
| `src/app`            | App Router pages, route handlers and German layout                          |
| `src/components`     | React workspace, forms and feature views                                    |
| `src/features`       | Transactional domain services; upload, import and delivery boundaries       |
| `src/server`         | Live identity, policy, validation, scoped queries and HTTP helpers          |
| `src/messages/de.ts` | Shared German labels                                                        |
| `prisma`             | Schema, generated-client configuration and reviewed SQL migrations          |
| `workers/score`      | Separate score parser process; generated libraries come from `build:worker` |
| `scripts`            | Bootstrap, provisioning, notification and verification commands             |
| `tests`, `e2e`       | Domain, database/auth regressions and browser smoke specifications          |
| `docs`               | Architecture, operation, extension and verification records                 |

## Verify

```sh
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run build
```

The default database tests use a disposable PGlite PostgreSQL engine and real Prisma driver calls. This exercises SQL and application transactions but cannot establish native PostgreSQL concurrency behavior. To run the main integration suite against native PostgreSQL, supply `TEST_DATABASE_URL` pointing to a **fresh disposable database whose name ends in `_test`**, then run `npm run test:integration`. Migrations create tables and test fixtures there; never use a production database.

`e2e/access.spec.ts` contains browser smoke checks. Start the application with test configuration, install matching browser binaries using `npx playwright install chromium`, then run `npm run test:e2e`. These browser checks were authored but not executed in this workspace.

`bash scripts/verify.sh` is a provider-neutral CI entrypoint. Configure native PostgreSQL as a service and supply `TEST_DATABASE_URL` in CI. No repository account is required to use the source.

## Production

Use a Node-capable host, PostgreSQL, a private S3 bucket, an email transport, TLS and a configured PDF malware scanner. `Dockerfile` builds a non-root standalone server. `compose.yaml` starts only the local database; it is not a complete production deployment. See `docs/OPERATIONS.md` before deploying.

Stage 1: read `docs/STAGE-01.md` for installation and acceptance checks, and `docs/STAGES.md` for the staged roadmap.

Stage 2: read `docs/STAGE-02.md` for Berlin calendar/time-entry behavior and your test checklist. No data migration is required.

Stage 3: read `docs/STAGE-03.md` before upgrading. This release requires the additive invitation migration (`npm run db:migrate`) and email configuration or explicit local manual mode.

Stage 8 adds the weekly assignment board. See `docs/STAGE-08.md` for upgrade notes and the test checklist.

Stage 9 adds driver and vehicle detail/history dialogs. See `docs/STAGE-09.md` for the test checklist.

Stage 10 adds multi-participant waves and requires the additive wave-participant migration. See `docs/STAGE-10.md` before upgrading.

Stage 11 adds inventory issue and return custody. Apply the additive migration and follow `docs/STAGE-11.md` for upgrade and testing.

Stage 12 adds searchable inventory movement history and database protection for saved movement records. Apply its additive migration and follow `docs/STAGE-12.md`.

Stage 13 adds in-app low-stock alerts. Apply its migration, configure a responsible staff member per item, and schedule `npm run jobs:stock` for periodic reconciliation. See `docs/STAGE-13.md`.

Stage 16 extends notifications with acknowledgement, assigned follow-up and durable in-app reminders. Apply its migration and schedule `npm run jobs:reminders`; see `docs/STAGE-16.md`. Stages 14–15 remain deferred pending real report samples.

Stage 17 adds **Audit & Sicherheit** for administrators, with filtered event investigation and account-access security records. Apply `20260920_audit_investigation`; see `docs/STAGE-17.md` for upgrade steps, coverage and browser tests.

Stage 18 adds server-side list sorting, consistent status filters and filtered report exports. No new migration is required; see `docs/STAGE-18.md` for testing.

Stage 19 provides `npm run deploy:check` and optional `-- --probe` HTTPS checks. Native deployment qualification is still pending; see `docs/STAGE-19.md`. No new migration is included.

Stage 20 distinguishes scanner detection from service failures and adds `npm run files:check`. The optional `-- --storage-probe` writes, reads and deletes one diagnostic object. See `docs/STAGE-20.md` before running it. Live scanner/storage qualification remains pending.
