import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

process.env.E2E_LOCAL_FIXTURE = "1";
process.env.E2E_TEST_PASSWORD ||= randomBytes(24).toString("hex");
export default defineConfig(base, {
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "node --import tsx scripts/browser-fixture.ts",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
