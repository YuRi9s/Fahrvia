import { describe, it, expect } from "vitest";
import {
  parseDelivery,
  deliveryScope,
} from "../src/features/delivery/validation";
import type { Principal } from "../src/server/policy";
const base = {
  driverId: "driver-a",
  kind: "PHR",
  date: "2027-01-01",
  intendedLocation: "Haustür",
  actualLocation: "Briefkasten",
  sourceReference: "Zustellbericht 4711",
};
const p: Principal = {
  userId: "u",
  organizationId: "org-a",
  role: "DRIVER",
  driverId: "driver-a",
  name: "A",
  email: "a@example.test",
  organizationName: "A",
};
describe("delivery details", () => {
  it("derives the ISO week including year boundary from the actual source date", () =>
    expect(parseDelivery(base).week).toBe("2026-W53"));
  it("requires actual source provenance and valid dates", () => {
    expect(() => parseDelivery({ ...base, sourceReference: "" })).toThrow();
    expect(() => parseDelivery({ ...base, date: "2026-02-30" })).toThrow();
  });
  it("requires both source locations for PHR", () =>
    expect(() => parseDelivery({ ...base, actualLocation: "" })).toThrow());
  it("requires a reported complaint category without calculating it", () => {
    expect(() =>
      parseDelivery({ ...base, kind: "CONCESSION", category: "" }),
    ).toThrow();
    expect(
      parseDelivery({
        ...base,
        kind: "CONCESSION",
        category: "Verpackung beschädigt",
      }).category,
    ).toBe("Verpackung beschädigt");
  });
  it("rejects client-controlled tenancy, weeks, and revision fields", () => {
    for (const field of ["organizationId", "week", "revision", "isCurrent"])
      expect(() => parseDelivery({ ...base, [field]: "other" })).toThrow();
  });
  it("cannot widen a driver's detail scope", () => {
    expect(deliveryScope(p)).toEqual({
      organizationId: "org-a",
      driverId: "driver-a",
    });
    expect(() => deliveryScope(p, "driver-b")).toThrow();
    expect(() => deliveryScope({ ...p, driverId: null })).toThrow();
  });
  it("denies dispatcher score detail access", () =>
    expect(() => deliveryScope({ ...p, role: "DISPATCHER" })).toThrow());
});
