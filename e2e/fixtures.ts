import { test as base, type Page } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The platform-appropriate modifier key: Meta on macOS, Control elsewhere. */
export const mod = platform() === "darwin" ? "Meta" : "Control";

export type SBServer = {
	url: string;
	port: number;
	spaceDir: string;
	/** Stop the server process (simulates "server down"). */
	stop: () => Promise<void>;
};

type SBFixtures = {
	spaceFiles: Record<string, string>;
	disableServiceWorker: boolean;
	sbServer: SBServer;
	sbPage: Page;
};

export async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address() as net.AddressInfo;
			srv.close(() => resolve(addr.port));
		});
		srv.on("error", reject);
	});
}

export async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const resp = await fetch(url);
			if (resp.ok) return;
		} catch {
			// server not ready yet
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

export const test = base.extend<SBFixtures>({
	spaceFiles: [{}, { option: true }],
	disableServiceWorker: [true, { option: true }],

	sbServer: async ({ spaceFiles, disableServiceWorker }, use) => {
		const spaceDir = await mkdtemp(join(tmpdir(), "sb-e2e-"));

		// Seed space with files
		for (const [path, content] of Object.entries(spaceFiles)) {
			const fullPath = join(spaceDir, path);
			await mkdir(dirname(fullPath), { recursive: true });
			await writeFile(fullPath, content);
		}

		const port = await getFreePort();

		const proc: ChildProcess = spawn(
			// The e2e suite runs against the Rust server (the release binary, with
			// the client bundle embedded — built by `make build-rs`).
			"./target/release/silverbullet",
			[spaceDir, "-p", String(port), "-L", "127.0.0.1"],
			{
				cwd: join(import.meta.dirname, ".."),
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					// Disable the server-side headless-Chrome runtime API: in
					// `?headless=1` the client uses its own in-page runtime, so the
					// e2e servers never need to spawn Chrome (and don't require it).
					SB_RUNTIME_API: "0",
					...(disableServiceWorker
						? { SB_DISABLE_SERVICE_WORKER: "1" }
						: {}),
				},
			},
		);

		let serverOutput = "";
		proc.stdout?.on("data", (d: Buffer) => {
			serverOutput += d.toString();
		});
		proc.stderr?.on("data", (d: Buffer) => {
			serverOutput += d.toString();
		});

		const url = `http://127.0.0.1:${port}`;

		try {
			await waitForServer(`${url}/.ping`);
		} catch (err) {
			proc.kill("SIGKILL");
			throw new Error(`Server failed to start. Output:\n${serverOutput}\n${err}`);
		}

		let stopped = false;
		const stop = (): Promise<void> => {
			if (stopped) return Promise.resolve();
			stopped = true;
			return new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					proc.kill("SIGKILL");
					resolve();
				}, 5000);
				proc.on("exit", () => {
					clearTimeout(timer);
					resolve();
				});
				proc.kill("SIGTERM");
			});
		};

		await use({ url, port, spaceDir, stop });

		// Cleanup
		await stop();
		await rm(spaceDir, { recursive: true, force: true });
	},

	sbPage: async ({ sbServer, page }, use) => {
		await gotoSilverBulletPage(page, sbServer);
		await use(page);
	},
});

/**
 * Navigate to a SilverBullet page in the test space and wait for the editor
 * to be visible. The test server runs with `SB_DISABLE_SERVICE_WORKER=1`, so
 * the boot path skips the service worker for deterministic test behavior.
 *
 * `pagePath` is the SilverBullet page name without the `.md` extension. Pass
 * an empty string (the default) to land on the index page. Each path segment
 * is URL-encoded so names with spaces or other special characters work.
 */
export async function gotoSilverBulletPage(
	page: Page,
	sbServer: SBServer,
	pagePath = "",
): Promise<void> {
	const encoded = pagePath.split("/").map(encodeURIComponent).join("/");
	await page.goto(`${sbServer.url}/${encoded}?headless=1`);
	await page.locator("#sb-editor .cm-editor").waitFor({ state: "visible", timeout: 30_000 });
	await waitForEditorReady(page);
}

/**
 * Wait for a full unsaved → saved transition on the current page, then fetch
 * the page content from the server's filesystem API.
 */
export async function waitForSaveAndReadFromServer(
	page: Page,
	sbServer: SBServer,
	pagePath: string,
): Promise<string> {
	const pageNameSel = "#sb-current-page";
	// Observe `sb-unsaved` first so we're past the edits the caller just made.
	await page.locator(`${pageNameSel}.sb-unsaved`).waitFor({ state: "attached", timeout: 10_000 });
	// Then wait for the round-trip back to `sb-saved` — this fires only after
	// `space.writePage(...)` resolves, which in HTTP mode means after the
	// server's PUT response.
	await page.locator(`${pageNameSel}.sb-saved`).waitFor({ state: "attached", timeout: 10_000 });
	const resp = await fetch(`${sbServer.url}/.fs/${pagePath}`);
	if (!resp.ok) {
		throw new Error(`Failed to read ${pagePath} from server: ${resp.status}`);
	}
	return resp.text();
}

/**
 * Wait for the SilverBullet client to finish booting widgets.
 */
export async function waitForEditorReady(page: Page): Promise<void> {
	await page.waitForFunction(
		() => (globalThis as any).sbRuntime?.ready === true,
		undefined,
		{ timeout: 15_000 },
	);
}

export { expect } from "@playwright/test";
