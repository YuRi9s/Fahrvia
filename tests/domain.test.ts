import { it, expect } from "vitest";
import {
  vehicleInput,
  timeInput,
  validWaveTransition,
  isoWeek,
  csvCell,
} from "../src/server/validation";
it("rental requires a provider", () =>
  expect(
    vehicleInput.safeParse({
      plate: "SB-AB 12",
      vin: "WVWZZZ1JZXW000001",
      brand: "VW",
      model: "Caddy",
      year: 2024,
      ownership: "RENTED",
      inFleet: "2026-09-01",
      keyCount: 2,
    }).success,
  ).toBe(false));
it("fleet departure must follow arrival", () =>
  expect(
    vehicleInput.safeParse({
      plate: "SB-AB 12",
      vin: "WVWZZZ1JZXW000001",
      brand: "VW",
      model: "Caddy",
      year: 2024,
      ownership: "OWNED",
      inFleet: "2026-09-02",
      deFleet: "2026-09-01",
      keyCount: 2,
    }).success,
  ).toBe(false));
it("rejects excessive breaks", () =>
  expect(
    timeInput.safeParse({
      driverId: "x",
      startAt: "2026-09-08T08:00:00Z",
      endAt: "2026-09-08T09:00:00Z",
      breakMinutes: 90,
    }).success,
  ).toBe(false));
it("prevents completed wave from reopening", () =>
  expect(validWaveTransition("COMPLETED", "ACTIVE")).toBe(false));
it("allows planned wave activation", () =>
  expect(validWaveTransition("PLANNED", "ACTIVE")).toBe(true));
it("ISO year can differ from calendar year", () =>
  expect(isoWeek(new Date("2021-01-01T12:00:00Z"))).toBe("2020-W53"));
it("CSV export neutralizes spreadsheet formulas", () =>
  expect(csvCell(' =HYPERLINK("evil")')).toContain("'"));
