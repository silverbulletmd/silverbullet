import type { Page } from "@playwright/test";
import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

/**
 * Tests for the `desiredIndexVersion` upgrade path.
 *
 * `client/data/object_index.ts` carries a `desiredIndexVersion` constant.
 * Bumping it should cause the next-loaded client to run a full space
 * reindex, but only once the client is sure it is on the same build as
 * the server (and, for the SW-enabled path, the initial space sync has
 * completed). These tests simulate "an old client booted after the
 * server upgrade" by writing a stale value into the local datastore
 * before reloading, then verifying that a real reindex actually fires
 * (not just that the stored version number bumps — see the "Performing
 * a full space reindex" log line).
 */

async function readIndexVersion(page: Page): Promise<number | undefined> {
	return await page.evaluate(async () => {
		const client = (globalThis as any).client;
		if (!client) return undefined;
		return (await client.ds.get(["$indexVersion"])) as number | undefined;
	});
}

async function writeIndexVersion(page: Page, version: number): Promise<void> {
	await page.evaluate(
		async (v) => {
			const client = (globalThis as any).client;
			if (!client) throw new Error("client not initialized");
			await client.ds.set(["$indexVersion"], v);
		},
		version,
	);
}

async function waitForIndexVersionAtLeast(
	page: Page,
	min: number,
	timeoutMs = 30_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const v = await readIndexVersion(page);
		if (typeof v === "number" && v >= min) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	const final = await readIndexVersion(page);
	throw new Error(
		`Index version did not reach ${min} within ${timeoutMs}ms (last value: ${String(final)})`,
	);
}

async function waitForEditor(page: Page): Promise<void> {
	await page.locator("#sb-editor .cm-editor").waitFor({ state: "visible", timeout: 30_000 });
}

async function readFullIndexCompleted(page: Page): Promise<boolean | undefined> {
	return await page.evaluate(() => {
		const client = (globalThis as any).client;
		if (!client) return undefined;
		return client.fullIndexCompleted as boolean;
	});
}

/**
 * Polls the live widget render-mode signals on the client. The
 * `widgetRenderMode` helper (see client/codemirror/util.ts) returns
 * "loading" whenever any of `systemReady`, `clientSystem.scriptsLoaded`,
 * `fullIndexCompleted` or `pageListLoaded` is false; this captures the
 * same set so a stale-version reload can prove the widgets don't drop
 * back into loading mode.
 */
async function waitForWidgetsReady(page: Page, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let last: unknown ;
	while (Date.now() < deadline) {
		last = await page.evaluate(() => {
			const client = (globalThis as any).client;
			if (!client) return null;
			return {
				systemReady: !!client.systemReady,
				scriptsLoaded: !!client.clientSystem?.scriptsLoaded,
				fullIndexCompleted: !!client.fullIndexCompleted,
				pageListLoaded: !!client.pageListLoaded,
			};
		});
		if (
			last &&
			typeof last === "object" &&
			(last as Record<string, boolean>).systemReady &&
			(last as Record<string, boolean>).scriptsLoaded &&
			(last as Record<string, boolean>).fullIndexCompleted &&
			(last as Record<string, boolean>).pageListLoaded
		) {
			return;
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(
		`Widgets did not reach the ready state within ${timeoutMs}ms (last state: ${JSON.stringify(last)})`,
	);
}

/**
 * Capture all `console` messages the page emits. The returned `messages`
 * array is updated live; callers can check for substrings after the
 * behavior of interest has had a chance to run.
 */
function captureConsole(page: Page): { messages: string[] } {
	const messages: string[] = [];
	page.on("console", (msg) => {
		messages.push(msg.text());
	});
	return { messages };
}

const REINDEX_LOG = "Performing a full space reindex";

async function waitForReindexLog(
	consoleState: { messages: string[] },
	timeoutMs = 30_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (consoleState.messages.some((m) => m.includes(REINDEX_LOG))) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	const tail = consoleState.messages.slice(-50).join("\n  ");
	throw new Error(
		`Did not observe a "${REINDEX_LOG}" log line within ${timeoutMs}ms.\nLast console output:\n  ${tail}`,
	);
}

/** Marker we embed in a `space-style` block to look for in the DOM. */
const SPACE_STYLE_MARKER = "stale-reindex-marker-color: rebeccapurple";

async function customStylesContent(page: Page): Promise<string> {
	return (await page.locator("#custom-styles").innerHTML()) ?? "";
}

test.describe("index version upgrade (service worker disabled)", () => {
	test.use({
		spaceFiles: {
			"index.md": "# Index\nFirst page in the upgrade-test space.",
			"Other.md": "# Other\nSee [[index]] for the entry point.",
			"Styles.md":
				`# Styles\n\n\`\`\`space-style\n/* ${SPACE_STYLE_MARKER} */\n\`\`\`\n`,
		},
	});

	test("stale index version triggers a real reindex on next boot", async ({ sbServer, page }) => {
		const consoleState = captureConsole(page);

		// First boot: let the initial indexing run to completion so we know
		// what value the current build considers "desired".
		await gotoSilverBulletPage(page, sbServer);
		await waitForEditor(page);
		await waitForIndexVersionAtLeast(page, 1);

		const baseline = await readIndexVersion(page);
		expect(typeof baseline).toBe("number");
		expect(baseline).toBeGreaterThan(0);
		// First boot is a fresh install (no stored version), so there
		// should be NO "Performing a full space reindex" log line yet.
		expect(consoleState.messages.some((m) => m.includes(REINDEX_LOG))).toBe(false);

		// Simulate "this client was previously running an older build that
		// stamped an older desiredIndexVersion into the datastore".
		await writeIndexVersion(page, 1);
		expect(await readIndexVersion(page)).toBe(1);

		// Re-navigate (the SW-disabled path runs the reindex check at the
		// end of `Client.init()`).
		await gotoSilverBulletPage(page, sbServer);
		await waitForEditor(page);

		// A stale-but-present index should not flip widgets into the
		// loading/spinner mode at boot — the existing entries are still
		// queryable until the actual reindex starts. (Before this fix the
		// boot-time flag was set from `hasFullIndexCompleted()`, which is
		// `stored >= desired` and therefore false during the wait, and
		// `updatePageListCache` would take the fallback branch and leave
		// `pageListLoaded` false.)
		expect(await readFullIndexCompleted(page)).toBe(true);
		await waitForWidgetsReady(page);
		// Custom styles must also load from the stale-but-present index —
		// before this was wired up, `loadCustomStyles` bailed out on the
		// strict `hasFullIndexCompleted` check and the `#custom-styles`
		// element stayed empty.
		expect(await customStylesContent(page)).toContain(SPACE_STYLE_MARKER);

		// Critical assertion: a real reindex must actually have run, not
		// just the stored version having been silently bumped.
		await waitForReindexLog(consoleState);
		await waitForIndexVersionAtLeast(page, baseline as number);
		expect(await readIndexVersion(page)).toBe(baseline);
	});
});

test.describe("index version upgrade (service worker enabled)", () => {
	// SW + IndexedDB interactions are flaky in Firefox's Playwright
	// implementation; mirror what pwa-offline does.
	test.skip(({ browserName }) => browserName !== "chromium", "SW path only runs on Chromium");
	test.describe.configure({ retries: 2 });

	test.use({
		disableServiceWorker: false,
		spaceFiles: {
			"index.md": "# Index\nFirst page in the SW-enabled upgrade test.",
			"Other.md": "# Other\nLink back to [[index]].",
			"Styles.md":
				`# Styles\n\n\`\`\`space-style\n/* ${SPACE_STYLE_MARKER} */\n\`\`\`\n`,
		},
	});

	test("stale index version triggers a real reindex after sync + version match", async ({ sbServer, page }) => {
		const consoleState = captureConsole(page);

		// First boot with the SW active: navigate without `?headless=1` so
		// the service worker actually registers.
		await page.goto(sbServer.url);
		await waitForEditor(page);
		await waitForIndexVersionAtLeast(page, 1);

		const baseline = await readIndexVersion(page);
		expect(typeof baseline).toBe("number");
		expect(baseline).toBeGreaterThan(0);
		expect(consoleState.messages.some((m) => m.includes(REINDEX_LOG))).toBe(false);

		await writeIndexVersion(page, 1);
		expect(await readIndexVersion(page)).toBe(1);

		// Re-navigate. The SW-enabled path triggers the reindex once both
		// `space-sync-complete` and a matching `server-version` message
		// have been observed.
		await page.goto(sbServer.url);
		await waitForEditor(page);

		// Stale-but-present index should keep widgets in their ready state
		// during the wait for sync + version-match (see the SW-disabled
		// test for the rationale).
		expect(await readFullIndexCompleted(page)).toBe(true);
		await waitForWidgetsReady(page);
		// Custom styles must also load from the stale-but-present index —
		// before this was wired up, `loadCustomStyles` bailed out on the
		// strict `hasFullIndexCompleted` check and the `#custom-styles`
		// element stayed empty.
		expect(await customStylesContent(page)).toContain(SPACE_STYLE_MARKER);

		await waitForReindexLog(consoleState);
		await waitForIndexVersionAtLeast(page, baseline as number);
		expect(await readIndexVersion(page)).toBe(baseline);
	});
});
