import { expect, mod, test, waitForSaveAndReadFromServer } from "./fixtures.ts";

test.describe("Editor formatting", () => {
	test("bold text with Mod+B", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Navigate to a fresh page
		await sbPage.keyboard.press(`${mod}+k`);
		await sbPage.locator(".sb-modal-box .cm-content").click();
		await sbPage.keyboard.type("Formatting Test", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(editor).toHaveText("");

		// Type some text
		await editor.click();
		await sbPage.keyboard.type("make this bold");

		// Select all
		await sbPage.keyboard.press(`${mod}+a`);

		// Apply bold
		await sbPage.keyboard.press(`${mod}+b`);

		// Verify bold markers appear
		await expect(editor).toContainText("**make this bold**");

		// Verify saved to server
		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Formatting Test.md");
		expect(content).toContain("**make this bold**");
	});

	test("italic text with Mod+I", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		await sbPage.keyboard.press(`${mod}+k`);
		await sbPage.locator(".sb-modal-box .cm-content").click();
		await sbPage.keyboard.type("Italic Test", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(editor).toHaveText("");

		await editor.click();
		await sbPage.keyboard.type("make this italic");
		await sbPage.keyboard.press(`${mod}+a`);
		await sbPage.keyboard.press(`${mod}+i`);

		await expect(editor).toContainText("_make this italic_");

		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Italic Test.md");
		expect(content).toContain("_make this italic_");
	});

	test("bullet list with Mod+Shift+8", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		await sbPage.keyboard.press(`${mod}+k`);
		await sbPage.locator(".sb-modal-box .cm-content").click();
		await sbPage.keyboard.type("List Test", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(editor).toHaveText("");

		// Type multiple lines
		await editor.click();
		await sbPage.keyboard.type("First item");
		await sbPage.keyboard.press("Enter");
		await sbPage.keyboard.type("Second item");
		await sbPage.keyboard.press("Enter");
		await sbPage.keyboard.type("Third item");

		// Select all and make it a bullet list
		await sbPage.keyboard.press(`${mod}+a`);
		await sbPage.keyboard.press(`${mod}+Shift+8`);

		// Verify bullet markers
		await expect(editor).toContainText("* First item");
		await expect(editor).toContainText("* Second item");
		await expect(editor).toContainText("* Third item");

		// Verify saved to server
		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "List Test.md");
		expect(content).toContain("* First item");
		expect(content).toContain("* Second item");
		expect(content).toContain("* Third item");
	});
});
