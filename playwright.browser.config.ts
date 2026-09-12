import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: process.env.CI ? "50%" : 1,
  retries: 0,
  outputDir: "test-results/browser",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/browser-results.json" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
