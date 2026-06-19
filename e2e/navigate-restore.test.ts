import {
	expect,
	gotoSilverBulletPage,
	mod,
	test,
	waitForEditorReady,
} from "./fixtures.ts";

// PageB is long enough to scroll and contains a "## Section" header for the
// explicit-pointer regression check. Line 12 sits in the first paragraph block.
const pageB = "# Page B\n\n" +
	Array.from({ length: 18 }, (_, i) => `Para line ${i + 1}`).join("\n") +
	"\n\n## Section\n\n" +
	Array.from({ length: 18 }, (_, i) => `More line ${i + 1}`).join("\n") +
	"\n";

// PageA carries the [[PageB]] link and is long enough to park a cursor
// mid-document (line 8) for the "Back restores the origin" test.
const pageA = "# Page A\n\nGo to [[PageB]]\n\n" +
	Array.from({ length: 18 }, (_, i) => `A line ${i + 1}`).join("\n") +
	"\n";

test.use({
	spaceFiles: {
		"PageA.md": pageA,
		"PageB.md": pageB,
	},
});

// Read the 1-based line number of the main selection head.
async function selectionLine(page: import("@playwright/test").Page): Promise<number> {
	return await page.evaluate(() => {
		const v = (globalThis as any).client.editorView;
		return v.state.doc.lineAt(v.state.selection.main.head).number;
	});
}

// Open PageB, park the cursor on line 12, then navigate away to PageA so
// PageB's position is captured into openLocations.
async function parkOnPageBThenLeave(page: import("@playwright/test").Page, sbServer: any) {
	await gotoSilverBulletPage(page, sbServer, "PageB");
	await waitForEditorReady(page);
	await page.evaluate(() => {
		const v = (globalThis as any).client.editorView;
		v.dispatch({ selection: { anchor: v.state.doc.line(12).from } });
		v.scrollDOM.scrollTop = 400;
		v.focus();
	});
	await page.evaluate(() => (globalThis as any).client.navigate({ path: "PageA.md" }));
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageA");
	await waitForEditorReady(page);
}

test("clean wiki-link navigation opens PageB at the top, not the remembered line", async ({ sbServer, page }) => {
	await parkOnPageBThenLeave(page, sbServer);

	const editor = page.locator("#sb-editor .cm-content");
	const wikiLink = editor.locator(".sb-wiki-link", { hasText: "PageB" });
	await expect(wikiLink).toBeVisible({ timeout: 10_000 });
	await wikiLink.click();

	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(1);
});

test("client.open restores the remembered line on PageB", async ({ sbServer, page }) => {
	await parkOnPageBThenLeave(page, sbServer);

	await page.evaluate(() => (globalThis as any).client.open({ path: "PageB.md" }));
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(12);
});

test("browser Back restores the remembered line on PageB", async ({ sbServer, page }) => {
	await parkOnPageBThenLeave(page, sbServer);

	await page.goBack();
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(12);
});

test("explicit #header pointer wins over both fresh and remembered position", async ({ sbServer, page }) => {
	await parkOnPageBThenLeave(page, sbServer);

	// Compute the expected line number from the pageB string constant so that
	// we do not need to query the DOM while on PageA (where "## Section" would
	// not be found and indexOf would return -1).
	const sectionLine = pageB.substring(0, pageB.indexOf("## Section")).split("\n").length;

	await page.evaluate(() =>
		(globalThis as any).client.navigate({ path: "PageB.md", details: { type: "header", header: "Section" } })
	);
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(sectionLine);
});

test("page picker restores the remembered line on PageB", async ({ sbServer, page }) => {
	await parkOnPageBThenLeave(page, sbServer);

	// Open the page navigator and pick PageB.
	await page.keyboard.press(`${mod}+k`);
	const pickerInput = page.locator(".sb-modal-box input.sb-input");
	await expect(pickerInput).toBeVisible();
	await pickerInput.click();
	await page.keyboard.type("PageB", { delay: 30 });
	await page.keyboard.press("Enter");

	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(12);
});

test("editor.open syscall restores the remembered line on PageB", async ({ sbServer, page }) => {
	await parkOnPageBThenLeave(page, sbServer);

	await page.evaluate(() =>
		(globalThis as any).client.clientSystem.localSyscall("editor.open", ["PageB"])
	);
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(12);
});

// The subtlest invariant: the restore intent is transient and never persisted
// into history.state. So a fresh forward navigation (which does NOT restore)
// must still leave the origin page restorable when the user presses Back.
test("fresh forward navigation, then browser Back, restores the origin page", async ({ sbServer, page }) => {
	await gotoSilverBulletPage(page, sbServer, "PageA");
	await waitForEditorReady(page);

	// Park the cursor mid-PageA.
	await page.evaluate(() => {
		const v = (globalThis as any).client.editorView;
		v.dispatch({ selection: { anchor: v.state.doc.line(8).from } });
		v.scrollDOM.scrollTop = 200;
		v.focus();
	});

	// Fresh forward navigation via wiki-link click: PageB opens at the top.
	const editor = page.locator("#sb-editor .cm-content");
	const wikiLink = editor.locator(".sb-wiki-link", { hasText: "PageB" });
	await expect(wikiLink).toBeVisible({ timeout: 10_000 });
	await wikiLink.click();
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageB");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(1);

	// Back to PageA must restore line 8 even though the forward nav was fresh.
	await page.goBack();
	await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue("PageA");
	await waitForEditorReady(page);
	expect(await selectionLine(page)).toBe(8);
});
