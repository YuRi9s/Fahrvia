# Stage 1 verification — 2026-09-09

Version 0.1.1, searchable record selectors.

| Check                                                    | Result                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New regression tests against the previous implementation | Failed as expected: full-name search returned no match; recipient page 5 incorrectly returned the first 100 records                                            |
| Full Vitest suite                                        | 61 tests passed across 9 files                                                                                                                                 |
| Database test scope                                      | Actual Prisma queries against disposable PGlite; 105 drivers, 105 vehicles and 105 candidate recipients; pagination/search/resolution and authorization checks |
| Production build                                         | Passed Next.js compilation, TypeScript, page generation and optimization                                                                                       |
| ESLint                                                   | Passed without diagnostics                                                                                                                                     |
| Prettier                                                 | All matched files passed                                                                                                                                       |

Browser-based interaction, keyboard behavior, mobile layout, animation timing and reduced-motion rendering were not executed here. The checklist in `STAGE-01.md` makes those outstanding acceptance checks explicit. The production build's TypeScript check also verifies the new component compiles; it does not prove interactive behavior.

No native PostgreSQL concurrency test, external-service integration test, live deployment or backup restore was performed for this bounded feature. Those remain later release gates. No schema migration or new dependency was introduced.
