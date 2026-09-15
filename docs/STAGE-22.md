# Stage 22 — Browser, mobile and accessibility checks

Version 0.1.22 improves mobile navigation and adds a disposable local test runner. Browser acceptance is not yet complete. No database migration or dependency change is required.

## Changes

The closed mobile sidebar is hidden visually and removed from interaction using `inert`. Opening it moves focus inside, keeps keyboard navigation within the drawer, makes the background inactive and prevents background scrolling. Escape, the close button, the backdrop and navigation links close it. Focus returns to the menu button when appropriate. The button exposes its expanded state and the controlled navigation region.

The skip link now says “Zum Hauptinhalt” and explicitly focuses the main content. The driver's bottom navigation has an accessible label and marks the current page. Existing drawer motion remains; reduced-motion settings disable it. Desktop navigation keeps its existing layout.

## Run the local checks

Use a separate extracted copy of this release with the project's required Node version. Preserve your working application and local startup changes. Do not run this fixture inside a project directory with an active Next.js server: both use the build directory.

```bash
npm ci
npx playwright install chromium
npm run test:e2e:local
```

If Playwright reports missing operating-system browser libraries, install its listed dependencies using your machine's normal administrator procedure, then rerun.

The runner starts the real Next.js development app on `127.0.0.1:3100` and a fresh in-memory PGlite database on `127.0.0.1:5499`. Both ports must be free. It applies migrations to that disposable database and creates administrator, dispatcher and driver test accounts with a randomly generated test password. It overrides database and email configuration; it never seeds your configured PostgreSQL database and sends no email. Next.js may load other project environment settings, which is another reason to use a separate extracted test copy.

The fixture database disappears when the runner stops. It is a test substitute, not native PostgreSQL qualification. Authentication remains real. Tests deliberately leave a quiet period between logins to respect the real authentication rate limiter. Do not remove production rate limiting to speed up tests.

The suite includes desktop Chromium and a Pixel 7 viewport. Desktop execution deliberately skips the mobile-only drawer case. Reports are written under `playwright-report`; open them with:

```bash
npx playwright show-report
```

Traces can contain session cookies and test form data. Share the failure summary first, not a raw trace from a real account.

## Automated coverage

- Anonymous page redirects, private API denial and forged-origin mutation denial.
- HTTP CSP nonce freshness and framing protections.
- Login labels, keyboard order, viewport fit, hydration and CSP violations.
- Real fixture authentication and private reads for all three roles.
- Driver and dispatcher navigation restrictions.
- Mobile drawer focus, Escape and focus restoration.
- Skip-link focus and reduced-motion drawer behaviour.
- Administrator creation-dialog naming, focus and Escape dismissal, without creating records.

`npm run test:e2e` retains the existing external-server mode. The new authenticated tests are skipped outside the disposable fixture because they must not guess or create production accounts. The full local suite contains 28 project/test combinations; an HTTP-only subset does not establish that browser interaction passed.

## Deployment acceptance still required

On a disposable HTTPS deployment with native PostgreSQL, test administrator MFA, dispatcher and driver sessions. Exercise representative create/edit flows, assignments, filters/pagination, document access, invitations and password recovery. Verify no console/CSP errors, no unexpected horizontal page overflow, and that denied actions disclose no records. Record browser/OS versions and results.

Check keyboard-only operation, focus visibility, labels and error announcements with a screen reader. Check 200% zoom, a narrow phone viewport, portrait/landscape and reduced motion. Test an actual iPhone/Safari and Android browser; Chromium device emulation does not establish Safari compatibility or physical-device behaviour. Verify touch scrolling within long menus and dialogs, and that focus/scroll state recovers when closing the drawer or widening the screen.

## Status

Chromium was absent from the development workspace, and downloading it timed out. Browser-dependent checks therefore remain unexecuted; no visual, screen-reader or production-CSP certification is claimed. See STAGE-22-VERIFICATION.md for the checks that did run.

Stages 19–21 retain their outstanding deployment/service checks. The count remains 23 unqualified/deferred/optional stages. Stage 23 covers native PostgreSQL concurrency; it is a separate delivery.
