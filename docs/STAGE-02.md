# Stage 2 — Berlin calendar and time entry

Version 0.1.2. Implemented for user acceptance; not a production release.

## Delivered

- Calendar days, ISO calendar-week selection and previous/next week navigation use Berlin calendar dates.
- Weekly database filters use Berlin Monday midnight through, but excluding, the following Monday midnight. A DST week may contain 167 or 169 hours.
- Planning, wave and work-time date/time fields display and interpret Europe/Berlin time regardless of the device timezone.
- Invalid dates and nonexistent spring times are rejected. Autumn repeated times require choosing the first or second occurrence; the choices display their UTC offset.
- Editing another field preserves the original timestamp, including seconds, milliseconds and its autumn occurrence, when the displayed date/time is unchanged.
- Calendar week/day changes have a short fade/slide transition, disabled under reduced motion.

Operational API timestamps must now be ISO strings with `Z` or an explicit offset, for example `2026-09-07T00:30:00+02:00`. Date-only fields such as vehicle entry/departure and document dates retain their existing meaning. Date objects remain accepted inside server code. The web forms send UTC ISO strings.

Existing database timestamps are not rewritten. If earlier device-timezone behavior caused a record to be entered incorrectly, review and correct that record explicitly. Monthly reporting defaults and document-expiry scheduling are outside this calendar-stage change.

## Install

Use a fresh extraction of the full source archive, copy your existing `.env`, and retain the same database. Stop the old development server before starting the new one.

```bash
npm ci
npm run db:generate
npm run dev
```

No migration, database reset or seed is needed. Preserve any unrelated local source edits when merging this release.

## Your acceptance checklist

Use test records you can safely delete afterward.

1. Open **Plan**, select **KW 37 / 2026**, and create a Monday event on **07.09.2026, 00:30–01:00**. It must appear on Monday, not Sunday or in KW 36.
2. Edit only that event's title. Reopen it: the date and time must stay unchanged.
3. Navigate from **KW 43 to KW 44 / 2026** and back. Also try **KW 53 / 2020 to KW 1 / 2021**. No week should repeat or be skipped.
4. Enter **29.03.2026, 02:30**. Berlin skips this time; saving must fail with an explanation. **03:30** should work with a later valid end time.
5. Enter **25.10.2026, 02:30**. Choose first or second occurrence. Save, reopen and verify the time. An unrelated edit must retain the chosen occurrence. To switch occurrences, choose the other option explicitly.
6. Optional: set your browser's emulated timezone to New York or Tokyo. The same records and input fields must still show Berlin times.
7. Check a wave and a work-time entry: both should show the Berlin timezone hint and preserve times after edits. Start/end validation and break rules still apply.
8. Change calendar day/week and observe the brief transition. Enable reduced motion: it should stop. Check narrow/mobile and dark mode.

Report the screen, steps and expected/actual result. We will address Stage 2 feedback before Stage 3 (staff invitations).

## Verification

New tests reproduced the old UTC-week and fixed-duration defects before correction. Automated coverage exercises Berlin Monday while UTC is Sunday, DST week/day lengths, invalid dates, repeated-hour choices, unchanged precision, year-crossing navigation and the real database's exclusive week boundary. The time tests also run with New York and Tokyo process timezones.

See `STAGE-02-VERIFICATION.md` for the final results. Browser interaction and animation appearance remain user acceptance checks, not completed automated browser verification.

## Implementation notes

`src/lib/berlin-time.ts` centralizes local-date arithmetic and conversion. It uses the runtime's IANA timezone rules through [Intl.DateTimeFormat.formatToParts](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts); no new dependency is required. Wall-time conversion checks candidate offsets by formatting each candidate back to the original local time. This distinguishes DST gaps from repeated times.

The shared date/time field is `src/components/berlin-date-field.tsx`. Calendar navigation and rendering consume the same helpers as server week validation. Persisted timestamps remain absolute UTC instants; local dates are used only for calendar arithmetic and input/display.
