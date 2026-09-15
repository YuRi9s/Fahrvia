import { test, expect } from "@playwright/test";
// These checks run against the actual HTTP server; authenticated flow tests need test-only accounts.
test("anonymous user is redirected to the German login", async ({ page }) => {
  await page.goto("/vehicles");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("E-Mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
});
test("private API does not disclose anonymous records", async ({ request }) => {
  const response = await request.get("/api/v1/vehicles");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).not.toContain("vin");
});
test("forged-origin mutation is rejected before parsing", async ({
  request,
}) => {
  const response = await request.post("/api/v1/vehicles", {
    headers: { origin: "https://untrusted.example.test" },
    data: { action: "create", data: {} },
  });
  expect(response.status()).toBe(403);
});
test("login respects the viewport and keyboard focus", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).focus();
  await expect(page.getByLabel("E-Mail", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Passwort", { exact: true })).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("login HTTP response has a fresh CSP nonce and framing protection", async ({
  request,
}) => {
  const first = await request.get("/login");
  const second = await request.get("/login");
  expect(first.status()).toBe(200);
  const csp = first.headers()["content-security-policy"];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-inline'");
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(second.headers()["content-security-policy"]).not.toContain(
    `'nonce-${nonce}'`,
  );
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
});

test("login hydrates without script errors or CSP violations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const target = window as typeof window & { cspViolations: string[] };
    target.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      target.cspViolations.push(event.violatedDirective);
    });
  });
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Passwort vergessen?", exact: true })
    .click();
  await expect(page.getByLabel("Passwort", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { cspViolations: string[] }).cspViolations,
    ),
  ).toEqual([]);
});
