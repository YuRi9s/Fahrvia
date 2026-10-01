# Local PostgreSQL operations — v0.1.22-db.1

The local database workflow was first delivered separately as v0.1.22-db.1. It is now integrated into **v0.1.25**, including Stage 22A shift controls, Stage 22B corrections and Stage 22C inspections. The current chain contains 18 migrations. Historical migration contents remain unchanged. Docker acceptance is still unqualified because Docker is unavailable here. Read `STAGE-22C.md` for the current release and `LOCAL-DATABASE-VERIFICATION.md` as the historical tooling-delivery report.

## Architecture and scope

The local operator is ordinary Node ESM with no dependencies at entry. It can run before `node_modules` exists. Its modules separate configuration, process execution, PostgreSQL operations, backup/restore and one-time administrator setup. Next.js never imports these modules or runs migrations on startup.

The old Compose design made `fleet` the image's bootstrap superuser and also recommended it as the application login. The old `.env` migration command used the runtime connection. This workflow supplies a dedicated Docker Compose project, persistent volume, separate operator configuration and three different identities. It does not adopt an unrelated native server or old Compose volume by guessing ownership. An unmanaged `.env` is a hard stop; see the transfer section.

The application's existing security model uses authenticated application tenant scoping, composite foreign keys and SQL constraints/triggers. **v0.1.22 does not implement SQL RLS policies.** This workflow neither adds fictitious RLS guarantees nor removes security controls. The runtime role has `NOBYPASSRLS`; authentication, MFA, CSP and application authorization are untouched.

## New machine

Prerequisites: Node **>=24.19.0 <25** with npm, Docker Engine or Docker Desktop running, and **Docker Compose 2.20+**. The user must be allowed to use Docker. Linux/macOS are the intended native shells; on Windows use WSL2 with Docker integration and keep the checkout in its Linux filesystem to enforce private POSIX permissions. Network access is needed for the pinned image and lockfile dependencies. No host PostgreSQL client installation is needed.

Extract the source, enter the directory containing `package.json`, and run:

```sh
npm run local:bootstrap
```

It checks Node/Docker, creates private configuration only if absent, installs exact dependencies when necessary, starts PostgreSQL **18.6-bookworm**, waits for the actual PostgreSQL health check, validates the host/container identity, provisions roles/database, deploys and verifies migrations, grants runtime permissions, generates Prisma and provisions an administrator only if no SUPER_ADMIN membership exists. Email, organization and a hidden password (16+ characters, repeated for confirmation) are requested interactively. Existing accounts are never overwritten; even an inactive existing SUPER_ADMIN prevents automatic account creation and requires deliberate account recovery.

The default database binding is **127.0.0.1:55432**. The app URL is `http://localhost:3000`. To select a different database port on first setup:

```sh
npm run local:bootstrap -- --port 55433
```

An occupied port fails before creating new configuration. If an existing configured container is stopped, it is started with its original volume. Repeated bootstrap preserves passwords, accounts and records. It does not reset volumes or migrate an unrelated database. If no backup is supplied, the new database starts empty except for the administrator/organization and audit event.

## Daily development

```sh
npm run local:dev
```

This checks the managed target, starts a stopped database, checks migration history, takes a backup if migrations are pending, applies those migrations, checks privileges and starts Next.js on the loopback origin in `.env`. When dependencies and migrations are current, it avoids `npm ci` and migration deployment. It generates Prisma and compiles the score worker before starting the app. Stop with Ctrl+C; PostgreSQL remains available and its records persist.

The app binds to loopback deliberately. Phone/LAN preview hosting is a separate configuration decision; this command does not expose database or application ports to the network.

```sh
npm run db:status
```

This verifies migration history and runtime privileges, and reports missing migrations without applying them. It may start a stopped container and ensure source dependencies exist; it is not a production read-only probe. Production retains `npm run deploy:check`.

## Upgrade without losing data

Stop the local app and workers. Update the source files while preserving **`.env`, `.local-db/` and `backups/`**. Do not overlay generated example credentials on these private files. Then:

```sh
npm run db:upgrade
npm run local:dev
```

Upgrade validates the managed container, exact PostgreSQL version, target database marker/owner, saved credentials, role flags and migration-history prefix. It rejects unfinished migrations, duplicate successful history, altered checksums, missing source migrations and non-prefix histories. It then writes a timestamped backup, invokes `prisma migrate deploy` with the migration identity, compares every source checksum with successful database history, runs `prisma migrate status`, applies runtime grants and checks runtime privileges. A no-pending upgrade still takes a backup and verifies Prisma status.

The backup is the recovery boundary. A migration failure exits nonzero; subsequent upgrade attempts reject unfinished history. Nothing calls `migrate reset`, auto-resolves migrations, reverses SQL or recreates the target. Inspect the failure and backup before an explicit recovery decision. Migrations may contain nontransactional SQL or committed partial changes: a failed command is not proof of an unchanged schema.

This is **schema migration**: change the database structure while retaining its records. **Data transfer** moves records between machines using a database archive and any associated file storage.

## Backup

```sh
npm run db:backup
```

The PostgreSQL 18 container runs `pg_dump --format=custom` as the migration identity. A read-only, repeatable-read exported snapshot is shared between `pg_dump` and row counts for every public table. Output streams into a mode-0600 `.partial` file; successful archive validation publishes a timestamped `.dump`. Its `.dump.json` companion contains SHA-256, table counts, source migration checksums and an authentication-secret fingerprint, **not** the secret itself. The directory is gitignored and excluded from Docker build context. Partial output is removed on failure, while existing complete backups remain.

Backups contain sensitive personal data and password hashes. They are not encrypted by this command. Keep access private and use encrypted storage/transfer. No automated retention deletes old backups. Large local databases may require timeout adjustment after review; native operations currently allow ten minutes, table-count queries thirty seconds each.

This is a local logical backup, not production PITR/WAL archiving or a complete disaster-recovery solution. Database archives do not contain S3 objects, local upload bytes or `BETTER_AUTH_SECRET`. Back up those separately and verify file retrieval after moving the application.

## Restore and move to another PC

Only restore backups from a trusted source: PostgreSQL archives contain executable SQL. `--yes` deliberately skips the destructive-action prompt; it does not bypass validation.

Existing managed installation:

```sh
npm run db:restore -- ./backups/fahriva-<timestamp>.dump
```

The command checks file type/header, validates the archive with `pg_restore --list`, checks its companion checksum and authentication-secret fingerprint when present, then requests `RESTORE fahriva` confirmation. It restores into a randomly named staging database using the **non-superuser migration role**, `--no-owner --no-acl --exit-on-error --single-transaction`. It verifies snapshot row counts when a companion manifest is available, checks migration history, applies newer migrations, reinstalls grants and verifies runtime access before touching the target.

Stop Next.js and every worker first. Active target connections block replacement; the tool does not kill them. It creates another safety backup, gates new connections, checks again for clients and renames the old target to a retained database with connections disabled. The validated staging database becomes `fahriva`. The old database is **not dropped**. Operators can inspect and deliberately remove retained databases later; no automatic destructive rollback or cleanup exists in normal commands.

For deliberate noninteractive restore:

```sh
npm run db:restore -- ./backups/fahriva-<timestamp>.dump --yes
```

On a **new PC**, copy the `.dump` and `.dump.json` companion, retain the original `BETTER_AUTH_SECRET` in a password manager, and transfer matching file storage. Extract a clean source directory, then:

```sh
npm run local:bootstrap -- --restore ./backups/fahriva-<timestamp>.dump
```

The bootstrap asks for the original authentication secret with hidden input when it creates `.env`. Keeping this value preserves encryption of MFA data. A new randomly generated secret cannot decrypt existing MFA records. The archive's fingerprint is checked when available. The restored administrator is reused; no new account is created if any SUPER_ADMIN exists. Older backups receive newer checked-in migrations before promotion. Never copy a Docker volume between PCs as a substitute for backup/restore.

For controlled automation, supply `RESTORE_AUTH_SECRET` through the process environment on first restore bootstrap. For new administrator creation, supply `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ORGANIZATION` and optionally `SEED_ADMIN_NAME`. Use a secret manager or hidden shell input, not literal secrets in shell history. The CLI never writes seed values to `.env` and never forwards them to Next.js. Clear one-time values from the parent shell afterward. An existing `.env` is never rewritten by restore; set its correct source authentication secret deliberately before restoring a backup from another installation.

Native custom-format archives without our JSON manifest are supported for transfer, but lack precomputed checksum/row-count/authentication-secret comparison. Their contents and migration history must still pass staged restore validation. Check business record totals and original MFA secret yourself for such imports.

## Existing Stage 19 native server or legacy Compose installation

The new tool intentionally **does not** take over your existing native PostgreSQL server at port 5433, alter its roles or replace its `.env`. It cannot safely infer migration credentials or ownership from a runtime URL. Existing native installs retain the explicit Stage 19 migration procedure until transferred.

One-time transition:

1. Keep the working application, `.env` and server unchanged. Stop writes and take a trusted native PostgreSQL 18 custom-format backup using the existing migration identity. Example (password requested by PostgreSQL, never embedded):

   ```sh
   pg_dump -h 127.0.0.1 -p 5433 -U fahriva_native19_migrator -d fahriva_native19 -W --format=custom --no-acl --file=fahriva-transfer.dump
   ```

2. Extract this delivery into a **separate clean directory**. Copy the archive there, preserve the old authentication secret privately, and run `npm run local:bootstrap -- --restore ./fahriva-transfer.dump`. Use `--port` if necessary. This leaves the old native server and files untouched.
3. Transfer matching file storage, test login/MFA, inspect representative business records and counts, then choose which instance to use. Subsequent managed Docker upgrades are one command.

The old default Compose project/`fleet` volume is likewise left alone. Do not attach it to the new configuration: environment variables on the Postgres image do not change roles/passwords in an existing initialized volume.

## Secrets and privileges

| Location / identity                   | Scope                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env` (0600)                         | Runtime URL with `fahriva_app` password, auth secret and normal app configuration. No bootstrap/migrator/seed values.                                                                                                              |
| `.local-db/config.json` (0600)        | Random installation UUID, random Compose project name, selected port, separate 32-byte random hex migration/runtime passwords.                                                                                                     |
| `.local-db/bootstrap-password` (0600) | Independent 32-byte random hex bootstrap password, mounted as a Docker secret using `POSTGRES_PASSWORD_FILE`.                                                                                                                      |
| `.local-db/compose.env`               | Selected local port only; no passwords.                                                                                                                                                                                            |
| `fahriva_bootstrap`                   | PostgreSQL image bootstrap superuser, used solely by the local operator for cluster/database/role lifecycle. Never supplied to Next.js.                                                                                            |
| `fahriva_migrator`                    | Owns managed database/schema/objects; login but NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOINHERIT, NOBYPASSRLS. Used for migrations/dumps/restores.                                                                  |
| `fahriva_app`                         | CONNECT and schema USAGE; table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT. No database/schema creation, TEMP, ownership, role memberships or elevated role flags. Migration history is SELECT-only. No TRUNCATE grant. |

Directory `.local-db` is mode 0700. Private-file symlinks and broad POSIX permissions are rejected. Existing credentials are never rotated automatically. SQL/child-process failures suppress raw output because tools may echo credentials. Passwords are not command-line arguments. Database role DDL is sent through stdin; migration URLs and temporary pg_dump/pg_restore passwords use dedicated child environments. Docker users and the OS account can access these local development secrets; Compose secrets are not a production secret manager.

Runtime grants are applied to existing objects and as migration-owner default privileges. Append-only audit triggers and constraints remain intact. PUBLIC create/use privileges are restricted in the managed schema, and PUBLIC access to cluster maintenance databases is revoked. A process lock prevents overlapping operations in one checkout; a PostgreSQL advisory lock in the maintenance database serializes cooperating operators across copies of the same configuration. Prisma also retains its own migration locking. These locks do not stop arbitrary external SQL administrators.

## Failure and recovery

- **Docker unavailable:** install/start Docker and enable user access. The preflight exits before generating configuration, installing dependencies or changing databases.
- **Port occupied:** choose a free port on first bootstrap. For an existing configured installation, identify the conflicting service; do not point the URL at a different database. Port changes must update the saved config, `.env` and container binding deliberately.
- **Existing unmanaged `.env`:** use the transfer procedure; the command never overwrites it.
- **Configuration/password missing or mismatch:** restore the matching `.local-db/` and `.env` from secure storage. Do not regenerate passwords over an initialized volume. The database comment and saved UUID must agree.
- **Stale process lock after termination:** verify no operator process is running, then remove only `.local-db/operation.lock`. Never delete the volume to remove a lock. PostgreSQL advisory locks are released when their session closes.
- **Failed migration:** use the matching source and inspect `_prisma_migrations.logs` privately. Diagnose partial changes. Choose a reviewed forward repair or explicit backup restore. Do not edit migration SQL, blindly run `migrate resolve`, or rerun seed to recover.
- **Interrupted restore before promotion:** the original target is unchanged and staging may remain. The printed staging name is for inspection; it is not automatically deleted.
- **Interrupted promotion:** the CLI prints the staging and retained names. Using the Docker bootstrap operator, inspect `pg_database` (`datname`, `datallowconn`, owner, comment) before any action. The old target may now be retained with connections disabled, and the new staging may or may not have been renamed. Do not start the application or blindly rerun bootstrap. Deliberately complete promotion and restore the expected database marker, or select the retained database as part of an explicit operator recovery. Keep the safety archive. Normal commands refuse a missing or mismatched target.
- **Disk full / timeout:** backup or staged restore fails closed. Resolve storage/capacity, inspect retained output and restart deliberately. No existing complete archive is removed.

No backups, business rows or volumes are deleted automatically. The opt-in acceptance test is the sole exception: it creates and cleans up its own randomized test project/volume, never the developer's project.

## Production and test infrastructure remain separate

`scripts/local-db.ts` and `scripts/browser-fixture.ts` remain disposable PGlite helpers. They are not development database provisioning and do not qualify native PostgreSQL behavior.

Production still uses an explicit migration job **before** application deployment, with `DATABASE_URL` provided to that job as the migration identity. `npm run db:migrate` is the existing low-level command: Node's `--env-file=.env` does not override an already supplied process `DATABASE_URL`. Do not run it casually using a runtime `.env`; use the reviewed deployment procedure and backup first. Do not pass the migration URL into the Next.js process. None of these local commands runs from `next start` or the production Docker entrypoint.

## Verification

```sh
npm run test:local-db
npm run test:local-db:docker
```

The first suite uses Node's built-in runner and needs no installed packages. The Docker suite is opt-in, requires Docker and source dependencies, creates clean temporary checkouts and random projects/ports, and runs the real commands. It exercises fresh bootstrap, repeated bootstrap, existing administrator preservation, stopped-container restart, no-pending upgrade, pending migration upgrade, backup/restore with preserved user IDs, restoring an older backup on another installation, runtime CREATE denial and failed-migration handling. It intentionally fails rather than silently skips when Docker is absent. It only removes volumes in test-owned random projects; cleanup failures retain their temporary configuration for manual inspection.

See `LOCAL-DATABASE-VERIFICATION.md` for this delivery's actual results. A passing unit test or archive TOC check does not establish native recovery acceptance.

Technical references: [PostgreSQL 18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [PostgreSQL 18 pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [Docker Compose health-based startup](https://docs.docker.com/compose/how-tos/startup-order/).
