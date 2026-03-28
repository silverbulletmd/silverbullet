import { expect, test } from "./fixtures.ts";

test.describe("Code block syntax highlighting", () => {
	test.use({
		spaceFiles: {
			"CodeTest.md": `\
# Code Blocks

\`\`\`javascript
const greeting = "hello world";
if (greeting) {
  console.log(greeting);
}
\`\`\`

\`\`\`python
def greet(name):
    return f"Hello {name}"
\`\`\`
`,
		},
	});

	test("javascript code block gets syntax highlighted", async ({ sbServer, page }) => {
		await page.goto(`${sbServer.url}/CodeTest?enableSW=0`);
		await page.locator("#sb-editor .cm-editor").waitFor({ state: "visible", timeout: 30_000 });
		const editor = page.locator("#sb-editor .cm-content");

		// Verify the code block content is rendered
		await expect(editor).toContainText("const greeting");

		// Wait for syntax highlighting to appear — CodeMirror applies
		// highlight classes like sb-keyword, sb-string, sb-variableName
		// to tokens inside code blocks. For dynamically loaded languages,
		// this may take a moment.
		const codeBlock = page.locator("#sb-editor .cm-editor");

		// "const" should be highlighted as a keyword
		await expect(codeBlock.locator(".sb-keyword", { hasText: "const" }))
			.toBeVisible({ timeout: 15_000 });

		// "greeting" should be highlighted as a variable name (appears multiple times)
		await expect(codeBlock.locator(".sb-variableName", { hasText: "greeting" }).first())
			.toBeVisible({ timeout: 5_000 });

		// The string literal should be highlighted
		await expect(codeBlock.locator(".sb-string", { hasText: '"hello world"' }))
			.toBeVisible({ timeout: 5_000 });
	});

	test("python code block gets syntax highlighted", async ({ sbServer, page }) => {
		await page.goto(`${sbServer.url}/CodeTest?enableSW=0`);
		await page.locator("#sb-editor .cm-editor").waitFor({ state: "visible", timeout: 30_000 });
		const editor = page.locator("#sb-editor .cm-content");

		await expect(editor).toContainText("def greet");

		const codeBlock = page.locator("#sb-editor .cm-editor");

		// "def" should be highlighted as a keyword
		await expect(codeBlock.locator(".sb-keyword", { hasText: "def" }))
			.toBeVisible({ timeout: 15_000 });

		// "return" should be highlighted as a keyword
		await expect(codeBlock.locator(".sb-keyword", { hasText: "return" }))
			.toBeVisible({ timeout: 5_000 });
	});
});
