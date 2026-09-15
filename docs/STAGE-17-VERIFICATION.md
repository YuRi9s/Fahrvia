# Stage 17 verification

Version 0.1.17, implementation checkpoint.

- Full automated suite: **189 tests passed across 23 files**.
- Nine new investigation tests cover tenant scope, unscoped historical events, stable pagination, combined filters, Berlin DST date ranges, invalid parameters, role restrictions, revoked memberships, metadata redaction and append-only security records.
- Existing account-change integration test now checks that a successful change creates exactly one security event and a rejected stale change creates no duplicate.
- Prisma generation, TypeScript, ESLint and score-worker compilation passed.
- Next.js production build passed.

Automated database tests use PGlite. No operational database was migrated; no live-user account was changed. Browser/mobile/accessibility acceptance and native production PostgreSQL qualification remain pending. Follow `STAGE-17.md` for the manual checklist and migration instructions.

The security view covers future account-access changes. It does not collect authentication attempts or all infrastructure/security events. No production-readiness certification is implied by these checks.
