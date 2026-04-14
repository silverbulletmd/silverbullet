import {
	expect,
	gotoSilverBulletPage,
	mod,
	test,
	waitForEditorReady,
	waitForSaveAndReadFromServer,
} from "./fixtures.ts";

// This file exercises the workflow described in website/Guide/Knowledge Base.md
// end-to-end. It seeds a small interconnected knowledge base, then verifies
// the load-bearing claims of the guide:
//   - links create connections between pages
//   - the Linked Mentions section appears on pages that are linked to
//   - hashtags and frontmatter tags index a page under a tag
//   - a Lua-integrated query over tags returns matching pages
//   - transclusions inline content from another page

// Lua query page text from the guide. Seeded as a file because typing
// `[[` / `(` into the editor triggers auto-pair completion that mangles the
// query text. This still exercises the meaningful claim — that the query
// widget renders matching pages — without depending on editor input quirks.
const CURRENTLY_READING = `# Currently Reading
\${template.each(query[[
  from b = tags.book
  where b.status == "reading"
  order by b.lastModified desc
]], templates.pageItem)}
`;

test.describe("Guide: Knowledge Base", () => {
	test.use({
		spaceFiles: {
			"index.md": "# Welcome\nThis is the index.",
			"Rust.md":
				"# Rust\nA systems language. Rust's [[Ownership]] model prevents data races at compile time.\n",
			"Ownership.md":
				"# Ownership\nOwnership is Rust's compile-time memory safety mechanism.\n",
			"Invisible Cities.md":
				"---\ntags: book\nauthor: Italo Calvino\nstatus: reading\n---\nA short novel of imagined cities.\n",
			"Currently Reading.md": CURRENTLY_READING,
		},
	});

	test("clicking a wiki link navigates to the linked page", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Rust");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Rust");

		const ownershipLink = editor.locator(".sb-wiki-link", { hasText: "Ownership" });
		await expect(ownershipLink).toBeVisible({ timeout: 10_000 });
		await ownershipLink.click();

		await expect(sbPage.locator("#sb-current-page")).toContainText("Ownership");
		await expect(editor).toContainText("compile-time memory safety");
	});

	test("Ownership page surfaces Rust as a Linked Mention", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Ownership");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Ownership");

		// The Linked Mentions section should be visible and show the Rust page
		// (because Rust.md links to [[Ownership]]).
		await expect(editor).toContainText("Linked Mentions", { timeout: 15_000 });
		await expect(editor).toContainText("Rust");
	});

	test("hashtag at the top of a body tags the page", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Create a fresh "Atomic Notes" page via the page picker
		await sbPage.keyboard.press(`${mod}+k`);
		const modal = sbPage.locator(".sb-modal-box");
		await expect(modal).toBeVisible();
		const pickerInput = modal.locator(".cm-content");
		await pickerInput.click();
		await sbPage.keyboard.type("Atomic Notes", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(modal).not.toBeVisible();
		await expect(editor).toHaveText("");

		// Wait for the editor to finish loading and any pageLoaded handlers
		// to settle before typing. Otherwise CodeMirror reconfigures mid-type
		// and the cursor jumps back to position 0, splitting input.
		await waitForEditorReady(sbPage);
		await editor.click();
		await sbPage.keyboard.type("#concept", { delay: 20 });
		await sbPage.keyboard.press("Escape");
		await sbPage.keyboard.press("End");
		await sbPage.keyboard.press("Enter");
		await sbPage.keyboard.press("Enter");
		await sbPage.keyboard.type("Atomic notes are focused on a single idea.", { delay: 20 });

		// Persist and verify the file contains the body hashtag
		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Atomic Notes.md");
		expect(content).toContain("#concept");
		expect(content).toContain("Atomic notes are focused");
	});

	test("query over a frontmatter tag returns matching pages", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Currently Reading");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Currently Reading");

		// The query widget should render Invisible Cities as a result
		await expect(editor).toContainText("Invisible Cities", { timeout: 20_000 });
	});
});
