# Stage 7 verification — 2026-09-10

Version 0.1.7.

| Check                          | Result                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest suite              | 123 tests passed across 15 files                                                                                                                    |
| Key lifecycle suite            | 10 tests passed using the actual Prisma adapter and disposable PGlite                                                                               |
| Lifecycle                      | Four active slots enforced; replacement creates a distinct identity and retains the old custody history; driver-held retirement/replacement blocked |
| Custody                        | Versioned changes, stale submissions, no-op changes and retired-key changes guarded; current actor permissions checked                              |
| Authorization                  | Foreign vehicles, unauthorized roles and revoked administrator privileges rejected; full histories restricted to staff                              |
| History                        | 28 events paginated; predecessor/replacement navigation verified; database rejects history rewrites                                                 |
| Competing replacement          | One success and one conflict; one active replacement remains under the single-connection PGlite adapter                                             |
| Upgrade                        | Existing IDs, slots, missing state and custody preserved; original events receive TRANSFER without invented reasons/events                          |
| Vehicle display                | Active key count excludes retired records; retired-key status filter verified                                                                       |
| TypeScript / ESLint / Prettier | Passed                                                                                                                                              |
| Production build               | Clean build passed and includes `/api/v1/keys/[id]/history`                                                                                         |

The initial tests failed for the missing lifecycle behavior. The first full run found an older upgrade fixture that assumed its migration was the latest. Account, category and key upgrade tests now identify their own migration explicitly. An intentionally rejected custody-history rewrite also exposed a connection failure in PGlite's socket path. The immutability test now uses the direct parameterized database query pattern already used for audit immutability; application reads/writes remain tested through Prisma. The targeted suite and full suite subsequently passed.

These checks do not qualify native PostgreSQL concurrency, browser/mobile/keyboard interaction, visual fidelity or a deployed production environment. Those gates remain pending. No live database or real email recipient was changed. Follow `STAGE-07.md` for the migration and user testing.
