import { it, expect } from "vitest";
import { isoWeek, weekRange, planInput } from "../src/server/validation";
it("uses Berlin Monday even while UTC is still Sunday", () => {
  expect(isoWeek(new Date("2026-09-06T22:30:00Z"))).toBe("2026-W37");
  expect(weekRange("2026-W37").start.toISOString()).toBe(
    "2026-09-06T22:00:00.000Z",
  );
});
it("uses local midnight at both ends of DST weeks", () => {
  const spring = weekRange("2026-W13"),
    autumn = weekRange("2026-W43");
  expect((spring.end.getTime() - spring.start.getTime()) / 3600000).toBe(167);
  expect((autumn.end.getTime() - autumn.start.getTime()) / 3600000).toBe(169);
});
it("rejects timezone-free operational timestamps at the API boundary", () => {
  expect(
    planInput.safeParse({
      title: "Ambiguous",
      startAt: "2026-10-25T02:15:00",
      endAt: "2026-10-25T03:30:00",
    }).success,
  ).toBe(false);
});

import {
  berlinInput,
  berlinCandidates,
  berlinToISO,
  berlinDayRange,
  shiftWeek,
} from "../src/lib/berlin-time";
it("formats and parses summer/winter time independently of device timezone", () => {
  expect(berlinInput("2026-09-06T22:30:00Z")).toBe("2026-09-07T00:30");
  expect(berlinToISO("2026-09-07T00:30")).toBe("2026-09-06T22:30:00.000Z");
  expect(berlinToISO("2026-01-05T00:30")).toBe("2026-01-04T23:30:00.000Z");
});
it("rejects nonexistent spring time and invalid dates", () => {
  for (const date of [
    "2026-03-29T02:30",
    "2026-02-30T12:00",
    "2026-09-07T24:00",
  ])
    expect(() => berlinToISO(date)).toThrow();
});
it("requires an explicit occurrence for the repeated autumn hour", () => {
  expect(berlinCandidates("2026-10-25T02:30")).toHaveLength(2);
  expect(() => berlinToISO("2026-10-25T02:30")).toThrow("zweimal");
  expect(berlinToISO("2026-10-25T02:30", "earlier")).toBe(
    "2026-10-25T00:30:00.000Z",
  );
  expect(berlinToISO("2026-10-25T02:30", "later")).toBe(
    "2026-10-25T01:30:00.000Z",
  );
});
it("retains precise existing timestamps when the displayed time is unchanged", () => {
  expect(berlinToISO("2026-10-25T02:30", "", "2026-10-25T01:30:42.123Z")).toBe(
    "2026-10-25T01:30:42.123Z",
  );
});
it("navigates calendar weeks instead of adding fixed hours", () => {
  expect(shiftWeek("2026-W43", 1)).toBe("2026-W44");
  expect(shiftWeek("2026-W14", -1)).toBe("2026-W13");
  expect(shiftWeek("2020-W53", 1)).toBe("2021-W01");
  expect(shiftWeek("2021-W01", -1)).toBe("2020-W53");
});
it("creates 23-hour and 25-hour calendar days", () => {
  for (const [date, hours] of [
    ["2026-03-29", 23],
    ["2026-10-25", 25],
  ] as const) {
    const range = berlinDayRange(date);
    expect((range.end.getTime() - range.start.getTime()) / 3600000).toBe(hours);
  }
});
