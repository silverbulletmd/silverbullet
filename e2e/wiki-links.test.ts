import {
	expect,
	gotoSilverBulletPage,
	mod,
	test,
	waitForSaveAndReadFromServer,
} from "./fixtures.ts";

test.describe("Wiki links", () => {
	test.describe("cross-page navigation", () => {
		test.use({
			spaceFiles: {
				"PageA.md": "# Page A\nLink to [[PageB]] here",
				"PageB.md": "# Page B\nThis is page B content",
			},
		});

		test("navigate between pages via wiki link click", async ({ sbServer, page }) => {
			await gotoSilverBulletPage(page, sbServer, "PageA");
			const editor = page.locator("#sb-editor .cm-content");

			await expect(page.locator("#sb-current-page")).toContainText("PageA");
			await expect(editor).toContainText("Page A");

			// Click on the "PageB" text inside the wiki link
			const wikiLinkText = editor.locator(".sb-wiki-link", { hasText: "PageB" });
			await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
			await wikiLinkText.click();

			// Should navigate to PageB
			await expect(page.locator("#sb-current-page")).toContainText("PageB");
			await expect(editor).toContainText("Page B");
		});
	});

	test("wiki link to non-existent page creates it on click and saves", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Navigate to a fresh page
		await sbPage.keyboard.press(`${mod}+k`);
		await sbPage.locator(".sb-modal-box .cm-content").click();
		await sbPage.keyboard.type("Link Source", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(editor).toHaveText("");

		// Type a wiki link to a page that doesn't exist
		await editor.click();
		await sbPage.keyboard.type("Check out [[Brand New Page]]", { delay: 20 });

		// Verify the source page with the wiki link is saved to server
		const sourceContent = await waitForSaveAndReadFromServer(sbPage, sbServer, "Link Source.md");
		expect(sourceContent).toContain("[[Brand New Page]]");

		// Move cursor away from the link so it renders
		await sbPage.keyboard.press("Home");

		// Click on the wiki link text to navigate/create
		const wikiLinkText = editor.locator(".sb-wiki-link", { hasText: "Brand New Page" });
		await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
		await wikiLinkText.click();

		await expect(sbPage.locator("#sb-current-page")).toContainText("Brand New Page");
	});
});
