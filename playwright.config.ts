import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	workers: 1,
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
				// CI runners have a small /dev/shm, which crashes the chromium
				// renderer (SEGV); route shared memory to /tmp instead.
				launchOptions: { args: ["--disable-dev-shm-usage"] },
			},
		},
		{
			name: "release",
			testMatch: "**/release-embedded.test.ts",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: { args: ["--disable-dev-shm-usage"] },
			},
		},
	],
});
