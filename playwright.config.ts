import { defineConfig, devices } from "@playwright/test";

// Distributions that patch browsers (e.g. NixOS) cannot execute Playwright's
// downloaded binaries; the devshell exports this pointing at the system
// chromium. Unset elsewhere → Playwright resolves its own browser as usual.
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const launchOptions = {
  args: ["--disable-dev-shm-usage"],
  ...(systemChromium ? { executablePath: systemChromium } : {}),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // Tests are fully isolated (unique temp space dir + dynamic port each), so
  // they run in parallel across workers. "50%" leaves a core per worker for
  // that worker's spawned server process; on CI it adapts to the runner size.
  workers: process.env.CI ? "50%" : 1,
  // Browsers occasionally crash at the process level in CI (notably a chromium
  // renderer SEGV); retry there so a stray crash doesn't fail the whole gate.
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The embedded-bundle test needs the release binary; it runs as its
      // own `release` project (see `make test-e2e-release`).
      testIgnore: "**/release-embedded.test.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions,
      },
    },
    {
      name: "firefox",
      testIgnore: "**/release-embedded.test.ts",
      retries: 2,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: "**/release-embedded.test.ts",
      retries: 2,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "release",
      testMatch: "**/release-embedded.test.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions,
      },
    },
  ],
});
