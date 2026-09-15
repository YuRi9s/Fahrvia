# Stage 22 verification

Version 0.1.22.

## Executed

- `npx playwright test --config playwright.local.config.ts --grep 'HTTP|private API|forged-origin' --reporter line`: 12 passed in 1.2 minutes. These are six HTTP cases repeated for the two configured projects; they do not launch a browser or prove mobile behaviour.
- The HTTP subset verifies anonymous denial, forged-origin denial, fresh CSP nonces and framing protection, and real administrator/dispatcher/driver authentication with private reads and restricted invitation access.
- The disposable fixture starts the real Next.js app, applies all existing migrations to in-memory PGlite, and seeds only that database.
- Fixture debugging found the socket server's default one-connection limit and the application's real sign-in rate limiter. The fixture now permits 20 connections and leaves 10.5 seconds between sign-ins. Production authentication was not weakened. Temporary diagnostic logging was removed.
- `npm run build`, `npm run typecheck` and `npm run lint`: passed.
- `playwright test --list`: discovers 28 project/test combinations. The mobile-only case is intentionally skipped on desktop.

## Blocked and pending

The browser-dependent attempt stopped at launch because the Chromium executable was absent. `npx playwright install chromium` repeatedly timed out and exited unsuccessfully. This was an infrastructure failure, not a reproduced failing assertion for the menu. The new menu interactions, focus restoration, reduced motion, hydration/CSP browser check and visual layout have not been executed here.

No physical phone, Safari, screen reader, zoom audit, administrator MFA browser session, production HTTPS CSP or native PostgreSQL browser qualification was performed. Do not mark Stage 22 complete based on HTTP tests. Follow STAGE-22.md and supply the local browser-run results.

No database migration is included. Existing backend unit/integration tests were not rerun solely for this UI/test-runner change; the Stage 21 result remains historical evidence.
