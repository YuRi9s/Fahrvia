import { describe, it, expect } from "vitest";
import { allowed, assertScope, type Principal } from "../src/server/policy";
const p: Principal = {
  userId: "u1",
  organizationId: "o1",
  role: "DRIVER",
  driverId: "d1",
  name: "Driver",
  email: "d@example.test",
  organizationName: "Test",
};
describe("resource authorization", () => {
  it("denies driver fleet mutations", () =>
    expect(allowed(p, "vehicles", "write")).toBe(false));
  it("allows own score reads", () =>
    expect(allowed(p, "score", "read")).toBe(true));
  it("denies dispatcher score access", () =>
    expect(allowed({ ...p, role: "DISPATCHER" }, "score", "read")).toBe(false));
  it("rejects foreign organizations", () =>
    expect(() =>
      assertScope(p, { organizationId: "o2", driverId: "d1" }),
    ).toThrow());
  it("rejects foreign drivers", () =>
    expect(() =>
      assertScope(p, { organizationId: "o1", driverId: "d2" }),
    ).toThrow());
  it("rejects absent driver ownership for driver-only records", () =>
    expect(() =>
      assertScope(p, { organizationId: "o1", driverId: null }),
    ).toThrow());
  it("accepts own record", () =>
    expect(() =>
      assertScope(p, { organizationId: "o1", driverId: "d1" }),
    ).not.toThrow());
});
it("allows invitation administration only for administrators", () => {
  expect(allowed({ ...p, role: "ADMIN" }, "invitations", "write")).toBe(true);
  expect(allowed({ ...p, role: "DISPATCHER" }, "invitations", "read")).toBe(
    false,
  );
  expect(allowed(p, "invitations", "read")).toBe(false);
});
