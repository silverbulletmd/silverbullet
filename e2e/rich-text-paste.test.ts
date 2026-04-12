import { expect, mod, test, waitForSaveAndReadFromServer } from "./fixtures.ts";

test.describe("Rich text paste", () => {
	test("first paste after load converts HTML to markdown", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Navigate to a fresh page
		await sbPage.keyboard.press(`${mod}+k`);
		await sbPage.locator(".sb-modal-box .cm-content").click();
		await sbPage.keyboard.type("Paste Test", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(editor).toHaveText("");
		await editor.click();

		// Simulate pasting rich text (HTML) via a synthetic ClipboardEvent.
		// This is the very first paste after page load, which used to fail
		// when turndown was loaded via dynamic import().
		const html = "<b>Hello</b> <em>world</em>";
		const plain = "Hello world";
		await sbPage.evaluate(
			({ html, plain }) => {
				const clipboardData = new DataTransfer();
				clipboardData.setData("text/html", html);
				clipboardData.setData("text/plain", plain);
				const event = new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
				});
				// Firefox ignores clipboardData in the constructor, so set it via defineProperty
				Object.defineProperty(event, "clipboardData", { value: clipboardData });
				document.querySelector("#sb-editor .cm-content")!
					.dispatchEvent(event);
			},
			{ html, plain },
		);

		// Verify the pasted content appears in the editor (bold markers are
		// hidden by clean mode, so check for the visible rendered text)
		await expect(editor).toContainText("Hello");
		await expect(editor).toContainText("world");

		// Verify the raw markdown saved to the server has proper formatting
		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Paste Test.md");
		expect(content).toContain("**Hello**");
		expect(content).toContain("*world*");
	});

	test("paste with link converts to markdown link", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		await sbPage.keyboard.press(`${mod}+k`);
		await sbPage.locator(".sb-modal-box .cm-content").click();
		await sbPage.keyboard.type("Paste Link Test", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(editor).toHaveText("");
		await editor.click();

		const html = '<a href="https://example.com">Example</a>';
		const plain = "Example";
		await sbPage.evaluate(
			({ html, plain }) => {
				const clipboardData = new DataTransfer();
				clipboardData.setData("text/html", html);
				clipboardData.setData("text/plain", plain);
				const event = new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
				});
				// Firefox ignores clipboardData in the constructor, so set it via defineProperty
				Object.defineProperty(event, "clipboardData", { value: clipboardData });
				document.querySelector("#sb-editor .cm-content")!
					.dispatchEvent(event);
			},
			{ html, plain },
		);

		await expect(editor).toContainText("[Example](https://example.com)");

		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Paste Link Test.md");
		expect(content).toContain("[Example](https://example.com)");
	});
});
