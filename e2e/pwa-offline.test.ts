import { expect, test } from "./fixtures.ts";

/**
 * PWA offline tests.
 *
 * These tests verify that the service worker correctly serves content from
 * local IndexedDB when the server becomes unreachable. There are two distinct
 * offline scenarios:
 *
 * 1. **Airplane mode** (no network at all): The browser's fetch() rejects
 *    instantly. The SW should fall through to serve cached local data.
 *
 * 2. **Server down** (network available but server unreachable): The browser's
 *    fetch() fails with "Failed to fetch" / "NetworkError" / "Load failed"
 *    depending on the browser. The SW should detect these as network errors
 *    and fall through to local data, rather than returning a hard 503.
 *
 * Both scenarios require that:
 * - An initial sync has completed (populating IndexedDB and the sync snapshot)
 * - The SW's `fullSyncConfirmed` flag is recovered from the persisted snapshot
 *   on restart, so it doesn't try to proxy requests to the dead server
 *
 * Note: We use page.goto() rather than page.reload() for offline navigation
 * because Playwright's CDP-level offline emulation blocks reload() with
 * ERR_INTERNET_DISCONNECTED before the service worker can intercept the request.
 * page.goto() works because the SW's fetch handler can respond from cache.
 *
 * See: https://github.com/silverbulletmd/silverbullet/issues/1931
 * See: https://github.com/silverbulletmd/silverbullet/issues/1923
 */

/** Wait for the service worker to be active and controlling the page. */
async function waitForServiceWorkerReady(page: import("@playwright/test").Page): Promise<void> {
	await page.evaluate(async () => {
		const reg = await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) {
			// SW is active but not yet controlling this page — wait for it to claim.
			await new Promise<void>((resolve) => {
				navigator.serviceWorker.addEventListener(
					"controllerchange",
					() => resolve(),
					{ once: true },
				);
				// Safety: if the controller appears between .ready and listener setup
				if (navigator.serviceWorker.controller) resolve();
			});
		}
		return reg.active?.state;
	});
}

/**
 * Wait for the initial sync to complete by listening for the
 * "space-sync-complete" message from the service worker. This ensures
 * IndexedDB has been populated with synced data before going offline.
 *
 * Important: content may appear in the editor before sync finishes, because
 * the SW can proxy requests to the server while syncing in the background.
 * Going offline before sync completes means IndexedDB may be empty.
 */
async function waitForSyncComplete(page: import("@playwright/test").Page): Promise<void> {
	await page.evaluate(() => {
		return new Promise<void>((resolve) => {
			navigator.serviceWorker.addEventListener("message", function handler(event: MessageEvent) {
				if (event.data?.type === "space-sync-complete") {
					navigator.serviceWorker.removeEventListener("message", handler);
					resolve();
				}
			});
		});
	});
}

test.describe("PWA offline support", () => {
	// Only run on Chromium — Firefox's Playwright implementation doesn't
	// fully support service worker + setOffline interactions.
	test.skip(({ browserName }) => browserName !== "chromium", "PWA offline tests only run on Chromium");
	test.describe.configure({ retries: 2 });

	test.use({
		spaceFiles: {
			"index.md": "# Offline Test Space\nThis content should survive offline.",
			"TestPage.md": "# Test Page\nOffline page content here.",
		},
	});

	test("app serves content offline in airplane mode", async ({ sbServer, page }) => {
		// Load the app with service worker enabled
		await page.goto(sbServer.url);
		const editor = page.locator("#sb-editor .cm-content");
		await editor.waitFor({ state: "visible", timeout: 30_000 });

		// Wait for the SW to be active, controlling this page, and synced
		await waitForServiceWorkerReady(page);
		await expect(editor).toContainText("This content should survive offline", { timeout: 30_000 });
		await waitForSyncComplete(page);

		// Simulate airplane mode — all network requests from both the page
		// and the service worker will fail instantly.
		await page.context().setOffline(true);

		// Navigate to the same URL (not reload — see file header comment).
		// The SW should serve the HTML shell from its pre-cache and /.fs
		// requests from IndexedDB.
		await page.goto(sbServer.url, { waitUntil: "domcontentloaded" });

		// Editor should re-appear with the same content from local data
		await editor.waitFor({ state: "visible", timeout: 30_000 });
		await expect(editor).toContainText("This content should survive offline", { timeout: 30_000 });
	});

	test("app serves content when server is down", async ({ sbServer, page }) => {
		// Load the app with service worker enabled
		await page.goto(sbServer.url);
		const editor = page.locator("#sb-editor .cm-content");
		await editor.waitFor({ state: "visible", timeout: 30_000 });

		// Wait for the SW to be active, controlling, and fully synced.
		// The sync wait is critical: content may appear from server proxy
		// before sync writes to IndexedDB. Without it, IndexedDB would be
		// empty when we kill the server.
		await waitForServiceWorkerReady(page);
		await expect(editor).toContainText("This content should survive offline", { timeout: 30_000 });
		await waitForSyncComplete(page);

		// Kill the server — network is still up but the server is unreachable.
		// This is the scenario from issue #1923: PWA works in airplane mode
		// but not when the server is specifically down.
		await sbServer.stop();

		// Navigate to same URL. The SW's fetch() to the server will fail with
		// browser native errors ("Failed to fetch", etc). With the
		// isNetworkError() fix, the SW should detect this and fall through to
		// local data for /.fs requests, while alwaysProxy paths (/.config)
		// correctly return 503 so the client falls back to localStorage cache.
		await page.goto(sbServer.url, { waitUntil: "domcontentloaded" });

		// Editor should re-appear with the same content from local IndexedDB
		await editor.waitFor({ state: "visible", timeout: 30_000 });
		await expect(editor).toContainText("This content should survive offline", { timeout: 30_000 });
	});

	test("app navigates to another page while offline", async ({ sbServer, page }) => {
		// Load the app with service worker enabled
		await page.goto(sbServer.url);
		const editor = page.locator("#sb-editor .cm-content");
		await editor.waitFor({ state: "visible", timeout: 30_000 });

		// Wait for the SW and initial sync
		await waitForServiceWorkerReady(page);
		await expect(editor).toContainText("This content should survive offline", { timeout: 30_000 });
		await waitForSyncComplete(page);

		// Navigate to TestPage to ensure it's synced locally, then back to index
		await page.goto(`${sbServer.url}/TestPage`);
		await expect(editor).toContainText("Offline page content here", { timeout: 30_000 });
		await page.goto(sbServer.url);
		await expect(editor).toContainText("This content should survive offline", { timeout: 30_000 });

		// Go offline
		await page.context().setOffline(true);

		// Navigate to TestPage while offline — the SW should serve it from IndexedDB
		await page.goto(`${sbServer.url}/TestPage`, { waitUntil: "domcontentloaded" });
		await editor.waitFor({ state: "visible", timeout: 30_000 });
		await expect(editor).toContainText("Offline page content here", { timeout: 30_000 });
	});
});
