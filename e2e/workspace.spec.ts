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

test("driver shift persists after refresh and can be paused, resumed and finished", async ({
  page,
}) => {
  await login(page, "driver");
  await page.goto("/work-times");
  await page
    .getByRole("button", { name: "Arbeit beginnen", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Arbeitszeit läuft" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Pause beginnen", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pause läuft" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Arbeit fortsetzen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Arbeit beenden", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Jetzt beenden", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Keine laufende Schicht" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bearbeiten", exact: true }),
  ).toHaveCount(0);
});
test("shift HTTP API authenticates and persists driver transitions", async ({
  request,
  baseURL,
}) => {
  const signIn = await request.post("/api/auth/sign-in/email", {
    headers: { origin: baseURL! },
    data: {
      email: "driver@browser.example.test",
      password: process.env.E2E_TEST_PASSWORD,
    },
  });
  expect(signIn.status()).toBe(200);
  const initial = await request.get("/api/v1/shift-clock");
  expect(initial.status()).toBe(200);
  const start = { action: "start", requestId: crypto.randomUUID() };
  const send = (data: object) =>
    request.post("/api/v1/shift-clock", {
      headers: { origin: baseURL! },
      data,
    });
  const started = await send(start);
  expect(started.status()).toBe(200);
  let state = await started.json();
  expect((await (await send(start)).json()).entry.id).toBe(state.entry.id);
  for (const action of ["pause", "resume", "finish"]) {
    const response = await send({
      action,
      requestId: crypto.randomUUID(),
      entryId: state.entry.id,
      expectedVersion: state.entry.version,
    });
    expect(response.status()).toBe(200);
    state = await response.json();
  }
  expect(state.entry.state).toBe("FINISHED");
  expect(
    state.entry.events.map((event: { action: string }) => event.action),
  ).toEqual(["start", "pause", "resume", "finish"]);
});
test("correction HTTP workflow keeps proposals separate and records an administrator decision", async ({
  request,
  baseURL,
  playwright,
}) => {
  const origin = { origin: baseURL! };
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers: origin,
        data: {
          email: "driver@browser.example.test",
          password: process.env.E2E_TEST_PASSWORD,
        },
      })
    ).status(),
  ).toBe(200);
  const started = await request.post("/api/v1/shift-clock", {
    headers: origin,
    data: { action: "start", requestId: crypto.randomUUID() },
  });
  expect(started.status()).toBe(200);
  const current = (await started.json()).entry;
  const finished = await request.post("/api/v1/shift-clock", {
    headers: origin,
    data: {
      action: "finish",
      requestId: crypto.randomUUID(),
      entryId: current.id,
      expectedVersion: current.version,
    },
  });
  expect(finished.status()).toBe(200);
  const entry = (await finished.json()).entry;
  const command = {
    action: "request",
    requestId: crypto.randomUUID(),
    entryId: entry.id,
    expectedVersion: entry.version,
    startAt: new Date(new Date(entry.startAt).getTime() - 1000).toISOString(),
    endAt: entry.endAt,
    breakMilliseconds: 0,
    reason: "Connection failed before recorded start.",
    evidenceDocumentId: null,
  };
  const submitted = await request.post("/api/v1/time-corrections", {
    headers: origin,
    data: command,
  });
  expect(submitted.status()).toBe(200);
  const { id } = await submitted.json();
  expect(
    (
      await request.post("/api/v1/time-corrections", {
        headers: origin,
        data: command,
      })
    ).status(),
  ).toBe(200);
  expect(
    (await (await request.get("/api/v1/shift-clock")).json()).entry.startAt,
  ).toBe(entry.startAt);
  const decision = {
    action: "decide",
    id,
    requestId: crypto.randomUUID(),
    decision: "APPROVED",
    reason: "Verified original start with supervisor.",
  };
  expect(
    (
      await request.post("/api/v1/time-corrections", {
        headers: origin,
        data: decision,
      })
    ).status(),
  ).toBe(403);
  const administrator = await playwright.request.newContext({ baseURL });
  try {
    expect(
      (
        await administrator.post("/api/auth/sign-in/email", {
          headers: origin,
          data: {
            email: "admin@browser.example.test",
            password: process.env.E2E_TEST_PASSWORD,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await administrator.post("/api/v1/time-corrections", {
          headers: origin,
          data: decision,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await administrator.post("/api/v1/time-corrections", {
          headers: origin,
          data: decision,
        })
      ).status(),
    ).toBe(200);
    const list = await request.get("/api/v1/time-corrections");
    expect(list.headers()["cache-control"]).toContain("no-store");
    expect(
      (await list.json()).items.find((r: { id: string }) => r.id === id).status,
    ).toBe("APPROVED");
    expect(
      (await (await request.get("/api/v1/shift-clock")).json()).entry.startAt,
    ).toBe(command.startAt);
  } finally {
    await administrator.dispose();
  }
});

test("inspection HTTP workflow validates photo views and persists private evidence", async ({
  request,
  baseURL,
  playwright,
}) => {
  test.setTimeout(90000);
  const sharp = (await import("sharp")).default;
  const headers = { origin: baseURL! };
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers,
        data: {
          email: "driver@browser.example.test",
          password: process.env.E2E_TEST_PASSWORD,
        },
      })
    ).status(),
  ).toBe(200);
  const start = await request.post("/api/v1/shift-clock", {
    headers,
    data: { action: "start", requestId: crypto.randomUUID() },
  });
  expect(start.status()).toBe(200);
  const entry = (await start.json()).entry;
  const state = await (await request.get("/api/v1/inspections")).json();
  expect(state.context.assignment.vehicle.plate).toBe("TEST-22C");
  const metadata = JSON.stringify({
    requestId: crypto.randomUUID(),
    entryId: entry.id,
    assignmentId: state.context.assignment.id,
    odometerKm: 30000,
    tyres: "OK",
    lights: "OK",
    mirrors: "OK",
    warnings: "OK",
    damage: false,
    notes: "",
  });
  const multipart: Record<
    string,
    string | { name: string; mimeType: string; buffer: Buffer }
  > = { metadata };
  let i = 0;
  for (const slot of ["front", "rear", "left", "right"]) {
    multipart[slot] = {
      name: slot + ".png",
      mimeType: "image/png",
      buffer: await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 3,
          background: { r: 30 + i++ * 40, g: 60, b: 90 },
        },
      })
        .png()
        .toBuffer(),
    };
  }
  const incomplete = { ...multipart };
  delete incomplete.rear;
  expect(
    (
      await request.post("/api/v1/inspections", {
        headers,
        multipart: incomplete,
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.post("/api/v1/inspections", {
        headers: { origin: "https://wrong.example" },
        multipart,
      })
    ).status(),
  ).toBe(403);
  const submitted = await request.post("/api/v1/inspections", {
    headers,
    multipart,
  });
  expect(submitted.status()).toBe(200);
  const receipt = await submitted.json();
  expect(
    await (
      await request.post("/api/v1/inspections", { headers, multipart })
    ).json(),
  ).toEqual(receipt);
  const list = await (await request.get("/api/v1/inspections")).json();
  expect(list.context.completedId).toBe(receipt.id);
  const row = list.items.find((x: { id: string }) => x.id === receipt.id);
  expect(row.report.files).toHaveLength(4);
  const image = await request.get(
    `/api/v1/files/${row.report.files[0].objectId}`,
  );
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/jpeg");
  expect(image.headers()["cache-control"]).toContain("no-store");
  const administrator = await playwright.request.newContext({ baseURL });
  try {
    expect(
      (
        await administrator.post("/api/auth/sign-in/email", {
          headers,
          data: {
            email: "admin@browser.example.test",
            password: process.env.E2E_TEST_PASSWORD,
          },
        })
      ).status(),
    ).toBe(200);
    const adminList = await (
      await administrator.get("/api/v1/inspections")
    ).json();
    expect(
      adminList.items.some((x: { id: string }) => x.id === receipt.id),
    ).toBe(true);
    expect(
      (
        await administrator.post("/api/v1/inspections", { headers, multipart })
      ).status(),
    ).toBe(403);
  } finally {
    await administrator.dispose();
  }
  expect(
    (
      await request.post("/api/v1/shift-clock", {
        headers,
        data: {
          action: "finish",
          requestId: crypto.randomUUID(),
          entryId: entry.id,
          expectedVersion: entry.version,
        },
      })
    ).status(),
  ).toBe(200);
});

test("guided inspection can be completed with labelled controls without horizontal overflow", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90000);
  const sharp = (await import("sharp")).default;
  await login(page, "driver");
  await page.goto("/work-times");
  await page
    .getByRole("button", { name: "Arbeit beginnen", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Fahrzeugprüfung",
    exact: true,
  });
  await panel.getByLabel("Kilometerstand (km)", { exact: true }).fill("43210");
  for (const label of [
    "Reifen und Räder",
    "Beleuchtung",
    "Spiegel und Scheiben",
    "Warnanzeigen",
  ])
    await panel.getByLabel(label, { exact: true }).selectOption("OK");
  await panel
    .getByLabel("Sichtbarer Schaden?", { exact: true })
    .selectOption("no");
  await panel
    .getByRole("button", { name: "Weiter zu den Fotos", exact: true })
    .click();
  let i = 0;
  for (const label of ["Vorne", "Hinten", "Linke Seite", "Rechte Seite"]) {
    await panel
      .getByLabel(`${label} fotografieren`, { exact: true })
      .setInputFiles({
        name: `view-${i}.png`,
        mimeType: "image/png",
        buffer: await sharp({
          create: {
            width: 20,
            height: 20,
            channels: 3,
            background: { r: 20 + i++ * 50, g: 100, b: 130 },
          },
        })
          .png()
          .toBuffer(),
      });
  }
  await expect(
    panel.getByAltText("Vorschau: Vorne", { exact: true }),
  ).toBeVisible();
  await page
    .locator(
      isMobile
        ? '.bottom-nav a[href="/vehicles"]'
        : '.sidebar a[href="/vehicles"]',
    )
    .click();
  await expect(page).toHaveURL(/\/vehicles$/);
  await page.goBack();
  await expect(
    panel.getByAltText("Vorschau: Vorne", { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Bericht prüfen", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Schritt 3 von 3 · Prüfen und einreichen",
      exact: true,
    }),
  ).toBeFocused();
  await panel
    .getByRole("button", {
      name: "Prüfung verbindlich einreichen",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("Prüfung für TEST-22C eingegangen", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({
    path: test.info().outputPath("inspection-receipt.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Arbeit beenden", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Jetzt beenden", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arbeit beginnen", exact: true }),
  ).toBeEnabled();
});
