import type { Page } from "@playwright/test";
import { expect, mod, test, waitForSaveAndReadFromServer } from "./fixtures.ts";

// This file exercises the workflow described in website/Journal.md end-to-end.
// The Journal feature is built in: the `Journal: Today` command and the
// default template at `Library/Std/Journal/Template` ship with SilverBullet.

/** Today's date as YYYY-MM-DD, matching the default journal page name. */
function today(): string {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Wait for the welcome page to be loaded (proxy for "the editor is ready and
 * the built-in libraries have registered their commands"), then run the
 * "Journal: Today" command via the command palette.
 */
async function runJournalToday(sbPage: Page): Promise<void> {
	const editor = sbPage.locator("#sb-editor .cm-content");
	await expect(editor).toContainText("Welcome");

	await sbPage.keyboard.press(`${mod}+/`);
	const modal = sbPage.locator(".sb-modal-box");
	await expect(modal).toBeVisible();

	const paletteInput = modal.locator(".cm-content");
	await paletteInput.click();
	await sbPage.keyboard.type("Journal: Today", { delay: 30 });

	// The command defined by the Journal template should appear
	await expect(
		modal.locator(".sb-option .sb-name", { hasText: "Journal: Today" }),
	).toBeVisible();

	await sbPage.keyboard.press("Enter");
	await expect(modal).not.toBeVisible();

	const expectedPage = `Journal/${today()}`;
	await expect(sbPage.locator("#sb-current-page")).toContainText(expectedPage);
}

test.describe("Guide: Journaling", () => {
	test.use({
		spaceFiles: {
			"index.md": "# Welcome\nA fresh space, ready to journal.",
		},
	});

	test("running 'Journal: Today' from the command palette creates today's journal page", async ({ sbPage }) => {
		await runJournalToday(sbPage);

		// The editor should show the template body — frontmatter sets
		// `tags: journal` (from the built-in template at
		// Library/Std/Journal/Template).
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("tags: journal");
	});

	test("created journal page is tagged journal on disk", async ({ sbPage, sbServer }) => {
		await runJournalToday(sbPage);

		// The file on disk must contain the `journal` tag from the template
		// frontmatter, so queries over `index.tag("journal")` (used by the
		// built-in `Journal: Previous Day` / `Next Day` commands and the
		// default index-page section) return this entry.
		const expectedPage = `Journal/${today()}`;
		const content = await waitForSaveAndReadFromServer(
			sbPage,
			sbServer,
			`${expectedPage}.md`,
		);
		expect(content).toContain("tags: journal");
	});

	test("new journal entry mentioning a topic shows up under that topic's Linked Mentions", async ({ sbPage, sbServer }) => {
		await runJournalToday(sbPage);

		// Type a journal entry that links to [[Alice]] — this is the
		// "watch topic pages come alive" flow from the guide.
		const editor = sbPage.locator("#sb-editor .cm-content");
		await editor.click();
		// The template places the cursor at the first bullet's content.
		await sbPage.keyboard.type("Reviewed the Q2 roadmap with [[Alice]]", { delay: 20 });

		// Wait for the journal page to save
		const expectedPage = `Journal/${today()}`;
		const journalContent = await waitForSaveAndReadFromServer(
			sbPage,
			sbServer,
			`${expectedPage}.md`,
		);
		expect(journalContent).toContain("[[Alice]]");

		// Navigate to Alice's page via the wiki link
		const wikiLinkText = editor.locator(".sb-wiki-link", { hasText: "Alice" });
		await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
		await wikiLinkText.click();

		await expect(sbPage.locator("#sb-current-page")).toContainText("Alice");

		// Alice's page should show a Linked Mentions section with the journal
		// entry we just wrote. The widget is rendered by a built-in script.
		const aliceEditor = sbPage.locator("#sb-editor .cm-content");
		await expect(aliceEditor).toContainText("Linked Mentions", { timeout: 15_000 });
		await expect(aliceEditor).toContainText("Reviewed the Q2 roadmap");
	});
});

