import { test, expect } from "@playwright/test";
test.skip(
  process.env.E2E_LOCAL_FIXTURE !== "1",
  "Requires disposable local fixture",
);
test("score Excel HTTP preview commit export and duplicate protection", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(90000);
  await new Promise((resolve) => setTimeout(resolve, 10500));
  const headers = { origin: baseURL! };
  const signed = await request.post("/api/auth/sign-in/email", {
    headers,
    data: {
      email: "admin@browser.example.test",
      password: process.env.E2E_TEST_PASSWORD,
    },
  });
  expect(signed.status()).toBe(200);
  const upload = {
    week: "2026-W40",
    file: {
      name: "score.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "email,Total Score,Pakete,Fotos (POD)\ndriver@browser.example.test,88,120,99%\n",
      ),
    },
  };
  const inspected = await request.post("/api/v1/score-imports", {
    headers,
    multipart: { ...upload, inspect: "true" },
  });
  expect(inspected.status()).toBe(201);
  expect((await inspected.json()).columns).toContain("Total Score");
  const preview = await request.post("/api/v1/score-imports", {
    headers,
    multipart: upload,
  });
  expect(preview.status()).toBe(201);
  const draft = await preview.json();
  expect(draft.errors).toEqual([]);
  const committed = await request.post(`/api/v1/score-imports/${draft.id}`, {
    headers,
    data: { action: "commit", confirmReplacement: true },
  });
  expect(committed.status()).toBe(200);
  expect(
    (
      await request.post("/api/v1/score-imports", {
        headers,
        multipart: upload,
      })
    ).status(),
  ).toBe(409);
  const exported = await request.get("/api/v1/score/export?week=2026-W40");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("spreadsheetml");
  expect(exported.headers()["cache-control"]).toContain("no-store");
  expect((await exported.body()).subarray(0, 2).toString()).toBe("PK");
});
