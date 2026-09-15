import { test, expect, type Page } from "@playwright/test";

test.skip(
  process.env.E2E_LOCAL_FIXTURE !== "1",
  "Requires disposable local fixture accounts.",
);
// Leave the full quiet window between fixture sign-ins; never disable the real limiter.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 10500));
});
async function login(page: Page, role = "admin") {
  await page.goto("/login");
  await page
    .getByLabel("E-Mail", { exact: true })
    .fill(`${role}@browser.example.test`);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
}
test("mobile navigation is hidden from keyboard until opened, traps focus, and restores it on Escape", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Mobile drawer behaviour");
  await login(page);
  await expect(
    page.getByRole("navigation", { name: "Betrieb", exact: true }),
  ).toHaveCount(0);
  const trigger = page.locator("#navigation-toggle");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const nav = page.getByRole("navigation", { name: "Betrieb", exact: true });
  await expect(nav).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
test("driver navigation shows own workspace without administrator modules", async ({
  page,
  isMobile,
}) => {
  await login(page, "driver");
  if (isMobile)
    await page
      .getByRole("button", { name: "Menü öffnen", exact: true })
      .click();
  const nav = page.getByRole("navigation", { name: "Betrieb", exact: true });
  await expect(
    nav.getByRole("link", { name: "Fahrzeuge", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Fahrer", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Einladungen", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("link", { name: "Fahrzeuge", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles$/);
  await expect(
    page.getByRole("heading", { name: "Fahrzeuge", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("dispatcher has no account-administration navigation", async ({
  page,
  isMobile,
}) => {
  await login(page, "dispatcher");
  if (isMobile)
    await page
      .getByRole("button", { name: "Menü öffnen", exact: true })
      .click();
  const nav = page.getByRole("navigation", { name: "Betrieb", exact: true });
  await expect(
    nav.getByRole("link", { name: "Fahrer", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Einladungen", exact: true }),
  ).toHaveCount(0);
});
test("reduced motion disables drawer animation and skip link focuses content", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await page
    .getByRole("link", { name: "Zum Hauptinhalt", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  if (isMobile) {
    await page
      .getByRole("button", { name: "Menü öffnen", exact: true })
      .click();
    expect(
      await page
        .locator(".sidebar")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");
  }
});

test("administrator can open a labelled creation dialog and dismiss it with Escape", async ({
  page,
}) => {
  await login(page);
  await page.goto("/drivers");
  const create = page.getByRole("button", {
    name: "+ Neu anlegen",
    exact: true,
  });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Neu anlegen", exact: true });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});

for (const role of ["admin", "dispatcher", "driver"]) {
  test(`fixture HTTP login and private read for ${role}`, async ({
    request,
    baseURL,
  }) => {
    const response = await request.post("/api/auth/sign-in/email", {
      headers: { origin: baseURL! },
      data: {
        email: `${role}@browser.example.test`,
        password: process.env.E2E_TEST_PASSWORD,
      },
    });
    expect(response.status()).toBe(200);
    const records = await request.get("/api/v1/vehicles");
    expect(records.status()).toBe(200);
    expect(records.headers()["cache-control"]).toContain("no-store");
    if (role !== "admin") {
      const denied = await request.get("/api/v1/invitations");
      expect(denied.status()).toBe(403);
    }
  });
}
