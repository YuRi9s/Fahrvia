# Stage 19 — Native deployment and migration qualification

Version 0.1.19 provides a read-only deployment checker and updated operating instructions. **Stage 19 is prepared but not yet qualified on your server.** No native PostgreSQL server or Docker executable was available in the development workspace. Passing unit tests or an embedded PostgreSQL test suite does not establish native deployment readiness.

## Run on Linux Mint / your deployment host

Use the complete source project with its existing private `.env`. Keep migration and runtime database identities separate. The checker requires the source dependencies, including `tsx`; it is not a command for the reduced standalone container image.

1. Install the lockfile dependencies with `npm ci --ignore-scripts --omit=peer` and build with `npm run build`.
2. Run `npm run deploy:check`. It prints a JSON report to the terminal and exits 1 when blocked. It does not modify records, migrate, reset, seed or send messages.
3. Address reported configuration errors locally. A development HTTP origin will fail the production HTTPS requirement; do not point the application at an invented HTTPS address to make the check pass. Configure the real TLS proxy first.
4. Review and back up an existing database before applying pending migrations. With the migration identity, run `npm run db:migrate`; then restore the runtime identity and rerun the check. Stop on unfinished migrations, checksum mismatches or unexpected newer migrations. Do not edit historical SQL, reset the database or mark a failed migration resolved merely to bypass the check.
5. Start the application with `npm start` under your service manager, using production configuration and the built worker files. Next.js start uses production mode. Configure the reverse proxy for the actual HTTPS origin and keep the backend port private.
6. Run `npm run deploy:check -- --probe` against that running deployment. This performs unauthenticated GET requests to the configured origin's `/api/health`, `/api/ready` and `/login`. Redirects, invalid TLS, timeouts and unexpected response shapes fail the check. It does not log in or exercise MFA.

To save a shareable report locally:

```bash
npm run deploy:check -- --probe > deployment-check.txt
```

The checker never prints connection URLs, environment values, secrets or raw database errors. Reports contain migration names and generic diagnostic messages. Review any surrounding terminal output before sharing; do not upload `.env`, passwords or tokens.

## What is checked

- Node version is within the repository's supported Node 24 range.
- Explicit PostgreSQL connection configuration and production HTTPS authentication origin.
- Authentication secret length/example markers; randomness is an operator responsibility.
- Production invitation mode and removal of temporary bootstrap/provisioning variables.
- Presence of the production build and parser-worker files; presence alone does not prove the build is fresh, so rebuild from the reviewed release.
- Database major version 18 and absence of superuser, database/role creation or RLS-bypass powers on the runtime role.
- Every checked-in migration has exactly one successful, matching SHA-256 history entry, with no unfinished or unknown newer migrations. Rolled-back attempts are excluded from successful history.
- Optional HTTPS process, readiness and login-page checks.

Database inspection runs in a read-only transaction with timeouts. The runtime role needs SELECT permission on `public._prisma_migrations` for this diagnostic. A migration operator can grant that specific read permission; do not grant superuser privileges to make the check work.

This does not inspect full table/sequence grants, SQL schema drift outside migrations, TLS proxy forwarding-header rules, scanner signatures, S3 access, email delivery, actual login/MFA, backup restoration or production load. Readiness currently means database connectivity, not all external services working.

## Qualification still required

Use disposable **native PostgreSQL 18** databases for both paths:

- **Fresh install:** apply the checked-in migration chain with Prisma, run the checker, start the built app and perform the HTTPS probes.
- **Upgrade:** restore a representative earlier backup into an isolated native database, record representative business counts/records, apply pending migrations and verify that those records and histories remain intact. Keep any original production database untouched during this exercise.

Repeat `npm run db:migrate` after a successful run and confirm there are no pending migrations. A preflight match checks migration history, not the outcome of a restore/upgrade rehearsal. Record command exit codes and the resulting checker report. Browser, file, email, native concurrency, recovery and monitoring qualification continue in stages 20–27.

## Current handoff

Stage 19 remains open until the native fresh-install/upgrade and real HTTPS startup checks are supplied. Twenty-three stages remain including this qualification stage, deferred stages 14–15 and twelve optional extensions. Share the checker report first; the next action depends on its actual findings.
