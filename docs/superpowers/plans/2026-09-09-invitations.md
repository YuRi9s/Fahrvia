# Staff Invitations Implementation Plan

Goal: complete Stage 3 invitation creation, expiry, resend, revocation and single-use acceptance before handing back to the user.

Architecture: an organization-scoped Invitation table stores SHA-256 token digests and immutable target role/email. Transactions lock invitations and driver profiles for acceptance. New credential accounts use Better Auth's password hashing and existing Account/Membership models. Public acceptance never accepts client roles or organization IDs. Tokens travel in URL fragments and POST bodies, not query strings.

Tech stack: existing React/Next.js, Prisma/PostgreSQL, Zod and Better Auth. No new dependencies.

Spec: user-approved Stage 3 in docs/STAGES.md and the design described in this turn.

## Tasks

- [x] Add regression tests for admin-only invitations, token use/expiry/revocation, rotation, driver linkage, existing-account protection and real Better Auth sign-in.
- [x] Add Invitation schema and an additive SQL migration; regenerate Prisma.
- [x] Implement src/features/invitations/service.ts and transport.ts: validate live inviter privileges; block cross-tenant driver links; hash tokens; rotate on resend; create Account/User/Membership in the acceptance transaction; record audits; report email handoff failure without logging tokens.
- [x] Wire scoped administration GET/POST routes, rate-limited public preview/accept POST routes, and invitations policy/navigation.
- [x] Add administrator and acceptance components with German copy, accessible forms and reduced-motion-aware transitions. Require explicit manual delivery configuration for local testing; forbid that mode in production.
- [x] Execute the full tests, build, TypeScript, lint and format checks. Include real local webhook integration and authentication-handler verification; no real recipients.
- [x] Document migration, local manual test flow, email webhook contract and outstanding browser/live-email gates; package the source and pause before Stage 4.

Safety constraints: no passwords/tokens in audit records or lists; no public signup; only SUPER_ADMIN may invite ADMIN; no invitation can grant SUPER_ADMIN. Existing-account reuse is rejected rather than resetting another person's password. Accepted/revoked invitations cannot be resent. Recheck the inviter and driver at acceptance. No production data reset. Single-use token links do not bypass the existing administrator MFA requirement.

Implementation and automated verification are complete. Browser/live-email acceptance is explicitly handed off in `docs/STAGE-03.md`. Stage 4 has not started.
