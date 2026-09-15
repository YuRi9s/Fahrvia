# Verification record

Stage 22 (0.1.22) improves mobile navigation accessibility and adds `npm run test:e2e:local`. See `docs/STAGE-22.md` (or `STAGE-22.md` from this folder). Browser execution and deployment acceptance remain pending.

Stage 21 (0.1.21) adds a shared invitation/recovery email transport, redirect rejection and `npm run email:check`. See `docs/STAGE-21.md` (or `STAGE-21.md` from this folder). Live provider and inbox qualification remains pending.

For the current 0.1.20 handoff, see `STAGE-20-VERIFICATION.md`. The record below is retained as the original baseline.

Checked 2026-09-08 against the delivered 0.1.0 source. This record distinguishes executed checks from specifications and infrastructure still awaiting verification.

| Check                                    | Result                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Prisma client generation                 | Passed with schema migrations and scoped dependency overrides                                                              |
| TypeScript strict project check          | Passed                                                                                                                     |
| ESLint                                   | Passed with no reported errors or warnings                                                                                 |
| Vitest                                   | 58 tests passed across 9 files                                                                                             |
| Next.js production build                 | Passed; dynamic pages and API routes compiled                                                                              |
| Production dependency audit              | 0 known vulnerabilities reported by `npm audit --omit=dev --json` after scoped patches                                     |
| Formatting                               | Checked separately; source formatted with Prettier                                                                         |
| Native PostgreSQL integration            | Entry point supplied; not executed in this workspace                                                                       |
| Browser/E2E/mobile/accessibility         | Smoke specifications supplied; not executed because the preview launcher is incompatible with the Node Next.js dev command |
| Production S3, email and malware scanner | Configuration and fail-closed behavior implemented; external integrations not exercised                                    |
| Docker startup, backup restore and load  | Not executed                                                                                                               |

The test suite covers domain validation and role policy; tenant-scoped fleet persistence; assignment exclusivity and service periods; inventory limits; audit immutability; score parser safety, isolated parsing and revision rollback; PHR/Concessions ownership and immutable correction; actual Better Auth enrollment, stale-session revocation, TOTP challenge and recovery; private-file policy; stale work-time approval; conversation participants, unread state and search; document renewal; and ISO-week filtering.

Default integration tests execute SQL against PGlite through Prisma's PostgreSQL adapter. The test pool uses one connection because the embedded protocol server serializes work. Constraint-negative checks use the engine's direct query interface to avoid a protocol-adapter connection-reset issue. This is useful transaction/constraint evidence, but not native PostgreSQL race or performance evidence.

A static security review was performed during implementation. Its concrete findings were fixed and important cases were added to regressions. No third-party penetration test or security certification was performed.

`e2e/access.spec.ts` contains desktop/mobile browser smoke tests for login redirection, private API response, origin rejection and keyboard/viewport behavior. It is not an executed screenshot report and does not yet cover all authenticated operator workflows.

Dependency audits report known advisories at the time of the scan; a zero result is not proof that the application or its dependencies have no vulnerabilities. Re-run the same gate when rebuilding.
