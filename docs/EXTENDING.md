# Extending the codebase

## Add a module

Start with a concrete workflow and its permission/ownership rules. Define a Zod input schema in `src/server/validation.ts` or a feature-local validation module. Unknown input fields are not permission claims. Resolve the organization from the principal, then query the resource with that organization before modifying it.

Keep transaction rules in `src/features/{feature}/service.ts`. Lock the parent record before checking state that another request could change. For workflows spanning vehicles and drivers, acquire locks in a consistent order (vehicle, then driver). Reuse the same order in archival, key checkout and assignment code. Add database constraints for invariants that must survive a second writer or an operator mistake.

Write the business mutation and audit event in the same transaction. Return a deliberately selected DTO, never a raw user/session/account row. Add the module to the explicit policy allowlist, its route contract, navigation and German labels. Review roles one action at a time; organization-wide read access does not imply account-revocation permission.

Meaningful tests should demonstrate forbidden state or disclosure: conflicting assignment, stale work-time approval, wrong participant, foreign organization, private document under a guessed object ID. Prefer these over tests that merely mirror helper implementations.

## Prisma and migrations

The client uses Prisma 7's `prisma-client` generator and PostgreSQL adapter. The output directory is `src/generated/prisma`. Regenerate after schema edits. Do not hand-edit generated code.

The SQL migrations contain intentional checks, partial indexes, tenant composite foreign keys and audit protections beyond the Prisma model. Preserve them when generating a new migration. Test migrations on a fresh disposable PostgreSQL database and an upgrade copy. Do not edit a migration already applied to a shared environment; add a new migration.

Better Auth plugins can add persistence fields. Inspect the installed plugin schema when upgrading and migrate those fields before enabling the new package. The MFA regression tests specifically protect enrollment/session semantics.

## React and accessibility

`Workspace` owns the navigation and current principal. Feature components call server APIs; they do not replace authorization with client-side role checks. `ModuleTable` handles the common list workflow; specialized components handle planning, conversations, imports and delivery details.

Keep form labels associated with controls, use semantic buttons/links, retain keyboard focus in dialogs and preserve visible error messages. Use shared CSS variables for both themes. Do not introduce business data into localStorage. The current CSS uses reduced-motion rules; any new animation needs an equivalent reduced-motion path.

The centralized German dictionary covers shared labels; several newer specialized views still contain German strings locally. Consolidating these is part of the remaining v1 cleanup. Preserve English code identifiers and documentation.

## Score and delivery data

The source workbook is data, not executable configuration. Reject formulas and active workbook content; preserve missing values as null. Unknown columns become named metrics only after preview/mapping. The parser does not infer PHR meaning or calculate a business score formula that was not supplied.

`build-score-worker.mjs` compiles the parser and its small validation dependencies to a separate process entrypoint. Any new parser dependency must be present in the production image. Keep the deadline, heap ceiling and concurrency gate when extending formats.

Manual PHR/Concessions details have explicit provenance and immutable correction history. They are independent of a score-import revision. If later importing delivery details from workbooks, add explicit source-revision linkage and define commit/revert semantics before combining the workflows.

## Dependency changes

Keep exact versions and the lockfile. Test the compatibility matrix, not just individual package versions. TypeScript 6 and Vitest 4 were selected because the installed lint/auth ecosystem did not support newer majors. Prisma's config dependencies have scoped security overrides documented in `DEPENDENCY_RESEARCH.md`; remove them when upstream ships compatible patched versions and the same gates pass.

Run lint, typecheck, tests, a production build and dependency audit. The provider-neutral `scripts/verify.sh` can run in CI. A passing local suite does not replace browser, native PostgreSQL concurrency, scanner, storage or restore verification.
