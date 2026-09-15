# Operations

## Configuration

`DATABASE_URL` is a PostgreSQL connection string. Give the application a non-superuser account with access only to its database. Use a distinct, more privileged migration identity. Prisma's application policy and SQL constraints enforce tenant boundaries; there is no PostgreSQL row-level-security policy in this checkpoint.

`BETTER_AUTH_URL` must be the canonical HTTPS origin in production. `BETTER_AUTH_SECRET` must be a private random value of at least 32 characters. The application rejects the example placeholder. Keep secrets in the host's secret manager. A reverse proxy must overwrite, rather than append untrusted client forwarding headers, and enforce request size/time limits.

`S3_BUCKET`, `AWS_REGION`, optional `S3_ENDPOINT`, and SDK credentials configure file storage. Prefer workload credentials over long-lived access keys. Deny public bucket access. The application uses random object keys, encryption on writes, server-mediated downloads and private/no-store HTTP responses. Production never falls back to local disk.

`MALWARE_SCANNER` is a fixed absolute executable path. The process is called with `--no-summary` and a private temporary PDF path. `clamscan` is a compatible example. Maintain virus signatures externally, mount them read-only into the runtime, and ensure the non-root process can read them. Missing or failed scanning rejects production PDF uploads. The supplied Dockerfile installs scanner programs but does not configure signature updates or run a scanner daemon for you.

`AUTH_EMAIL_WEBHOOK_URL` and `AUTH_EMAIL_WEBHOOK_TOKEN` configure password reset delivery. The application sends `{to, template:"password-reset", url}` using an authenticated HTTPS POST. Supply a private service that actually sends the email; there is no vendor account or SMTP password in this repository. Failed delivery is not presented as successful delivery by the backend.

## Database and application release

1. Take a database backup and confirm the matching object-store retention policy.
2. Build the image from the reviewed lockfile using `docker build -t fahriva:0.1.19 .`.
3. In a separate migration job with the source/development tooling available, run `npm run db:migrate`. Review SQL before applying to an existing environment.
4. Start the image with production environment variables and attach the private scanner signature volume.
5. Use `/api/health` for process liveness and `/api/ready` for database connectivity. Readiness does not check email, scanner or S3; exercise those integrations explicitly.
6. Complete role/tenant, MFA, upload and restore checks before granting real users access.

For source deployment, `npm run build` generates the Prisma client and parser-worker libraries before Next.js builds. `npm start` serves the resulting application. Keep `workers/score/worker.mjs`, its generated `lib` tree and production dependencies alongside the server. The Dockerfile copies these explicitly.

## Accounts

The bootstrap command creates a new organization and one SUPER_ADMIN. It does not reset existing passwords or create sample business data.

To provision an already-created active driver profile, set `PROVISION_DRIVER_ID`, `PROVISION_ADMIN_EMAIL`, and a unique `PROVISION_PASSWORD` of at least 16 characters in your private `.env`, then run `npm run db:provision-driver`. The named administrator must have active membership in the same organization. This is an operator command requiring database access, not an HTTP authentication mechanism. Deliver the password privately and remove it from the environment afterward.

Driver archival blocks while an assignment or held key remains, deactivates linked membership and revokes sessions. Account invitations, role/access administration and driver reactivation are implemented. Multi-organization selection remains outside this checkpoint. Do not improvise role updates directly in a browser or trust client role values.

MFA uses the installed Better Auth TOTP and recovery-code implementation. Enrollment revokes previous password-only sessions; privileged production requests also require session-specific MFA assurance. Recovery codes must be stored privately by the account owner. The login UI offers both TOTP and recovery-code entry; backend recovery behavior is covered by regression tests.

## Scheduled work

Run `npm run jobs:expiry` daily in a scheduler using the same database configuration. It emits approaching/expired document alerts for organization administrators and the associated driver. Deterministic alert IDs avoid duplicates when the job is retried. It also removes old fixed-window mutation counters. These alerts use in-app delivery. Stage 16 adds owned notification workflows and a reminder job; schedule `npm run jobs:reminders` (for example every five minutes) and retain `npm run jobs:stock` as documented in stages 13 and 16. No external email delivery is implied for operational reminders.

Score parsing launches at most two child processes per application instance, kills a task after five seconds and sets a 128 MiB V8 old-space ceiling. Uploads are limited to 5 MiB for score files, 16 MiB expanded XLSX content, 5,000 rows and 100 columns. The heap ceiling is not an operating-system RSS limit; use container memory/CPU limits and admission control for production load.

## Backups, retention and recovery

Back up PostgreSQL and private object storage as a coordinated pair. Restore both into an isolated environment and check document/source-file retrieval and import history before relying on the backup. Audit rows reject UPDATE/DELETE at the database level; plan retention with a reviewed migration and a privileged maintenance role rather than disabling protections in request handlers.

Document renewals archive the prior record while keeping its metadata and bytes. Score rollback switches the active revision while retaining source files and all score rows. PHR/Concessions manual revisions have their own history; score rollback does not change those independently recorded details. Define retention/deletion periods with the business owner before production.

## Known operational limits

Native PostgreSQL race tests, actual S3/scanner/email delivery, Docker startup, backup restoration, load tests and browser/mobile accessibility checks have not been completed here. The included development database helper is for disposable local experimentation and does not upgrade an existing embedded data directory. Standard development and production use the reviewed Prisma migrations on PostgreSQL.

## Source deployment preflight (Stage 19)

After building the reviewed source, run `npm run deploy:check` with the runtime environment. It checks configuration, build files and migration history in a read-only transaction. After startup behind the real TLS proxy, use `npm run deploy:check -- --probe` for health/readiness/login-page probes. See `STAGE-19.md` for checks, limits and the required disposable native fresh-install/upgrade rehearsal. This stage has not yet passed on a native deployment host.
