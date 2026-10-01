> Historical report for the original v0.1.22-db.1 tooling delivery. The tooling is integrated into v0.1.25; see STAGE-22C-VERIFICATION.md for current checks.

# Local database workflow — delivery verification

Baseline: supplied v0.1.22 source archive. Delivery: **0.1.22-db.1**. Date: 2026-09-16.

**Implementation delivered; native Docker acceptance remains blocked.** Docker executable/daemon is unavailable in this workspace. No real database, container or volume was created, migrated, backed up or restored here. Do not treat the unit tests or production build as proof of native recovery.

## Commands actually run

| Command                                                                      | Result                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run test:local-db`                                                      | PASS: 13 Node tests; no skipped tests.                                                                                  |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=20000` | PASS: all 224 existing tests across 27 files, 57.97 seconds on the final run.                                           |
| `npm run db:generate`                                                        | PASS: Prisma 7.10.0 client generated against unchanged v0.1.22 schema.                                                  |
| `npm run build:worker`                                                       | PASS.                                                                                                                   |
| `npm run build`                                                              | PASS: production compilation, TypeScript and route generation.                                                          |
| `npm run typecheck`                                                          | PASS.                                                                                                                   |
| `npm run lint`                                                               | PASS. Targeted lint of local operator/test modules also passed after final edits.                                       |
| `npm run test:local-db:docker`                                               | BLOCKED / exit 1: Docker daemon unavailable. Acceptance intentionally fails instead of reporting a skipped/pass result. |
| `npm run local:bootstrap`                                                    | Expected failure / exit 1 at Docker preflight. Confirmed no `.env` or `.local-db` was created.                          |

Formatting was applied with the repository's pinned Prettier to the changed operator, tests, Compose and Markdown files. Source comparison against the baseline archive confirmed that every historical migration, Prisma schema and application source file is byte-for-byte unchanged. Only package version metadata changed in the lockfile; dependency resolutions were not updated.

An initial production-build attempt used an external `node_modules` symlink, which Turbopack rejected. The verification checkout was changed to a normal directory of the same installed package contents. The initial full suite also had two S3-mock resolution failures with that symlink arrangement. The eight file-storage tests then passed, and the final full 224-test run passed. No application or storage code was modified to make these checks pass. Fresh `npm ci` inside the Docker acceptance scenario remains unexecuted because preflight correctly stops first when Docker is unavailable.

## New unit coverage

Supported Node versions; strict command arguments and restore confirmation flags; pending migration suffixes versus incomplete/changed/unknown/duplicate histories; subprocess environment isolation; managed URL/configuration validation; secure first configuration and byte-preserving reruns; rejection of unmanaged `.env`; override/seed-environment rejection; private-file permissions; process-lock exclusion; occupied ports; secret-safe subprocess errors; archive-listing early pipe closure; and preservation of the original MFA encryption secret during new-machine restore configuration.

## Real Docker acceptance provided, not executed

`tests/local/docker.acceptance.mjs` drives actual npm commands in temporary source copies with random projects and ports. It covers:

- Fresh checkout and administrator creation with random one-time credentials.
- Idempotent reruns preserving configuration and user identifiers.
- Starting a stopped container without removing its volume.
- Real pending and no-pending Prisma upgrades.
- Native custom-format backup and restore, including older-backup migration.
- A second clean installation restored from the first installation's archive.
- Runtime role flags and denial of schema CREATE.
- Invalid archive rejection and preservation of the target's user records.
- Refusal to recreate a lost previously initialized database volume.
- Deliberately failed migration, a pre-failure backup, preserved records, and refusal to continue over unfinished history.

Run on a Docker-enabled development machine:

```sh
npm run local:bootstrap
npm run test:local-db:docker
```

The acceptance test deletes only its randomized test-owned volumes. It does not operate on the configured developer volume. Failed cleanup retains the test configuration and prints its temporary path. It may install dependencies in its temporary checkouts and requires registry/image access. Its maximum test budget is 30 minutes.

## File-by-file delivery inventory

Changed (11):

- `.dockerignore`
- `.env.example`
- `.gitignore`
- `CHANGELOG.md`
- `README.md`
- `compose.yaml`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/RELEASE_STATUS.md`
- `package-lock.json`
- `package.json`

Added (13):

- `docs/LOCAL-DATABASE-VERIFICATION.md`
- `docs/LOCAL-DATABASE.md`
- `scripts/local-cli.mjs`
- `scripts/local/admin.mjs`
- `scripts/local/backup.mjs`
- `scripts/local/config.mjs`
- `scripts/local/core.mjs`
- `scripts/local/database.mjs`
- `scripts/local/process.mjs`
- `scripts/local/prompt.mjs`
- `tests/local/config.test.mjs`
- `tests/local/core.test.mjs`
- `tests/local/docker.acceptance.mjs`

No historical migration, schema, product/UI, authentication, CSP, seed script or PGlite fixture was modified. No production startup migration hook was added.
