import { expect, test, waitForSaveAndReadFromServer } from "./fixtures.ts";

test.describe("Task management", () => {
	test.use({
		spaceFiles: {
			"Tasks.md": "# My Tasks\n* [ ] Buy groceries\n* [ ] Write tests\n* [x] Already done",
		},
	});

	test("task checkboxes render", async ({ sbServer, page }) => {
		await page.goto(`${sbServer.url}/Tasks?enableSW=0`);
		await page.locator("#sb-editor .cm-editor").waitFor({ state: "visible", timeout: 30_000 });
		const editor = page.locator("#sb-editor .cm-content");

		await expect(page.locator("#sb-current-page")).toContainText("Tasks");
		await expect(editor).toContainText("Buy groceries");

		// Task checkboxes render as <span class="sb-checkbox"><input type="checkbox"></span>
		const checkboxes = page.locator(".sb-checkbox input[type='checkbox']");
		await expect(checkboxes.first()).toBeVisible({ timeout: 10_000 });
		await expect(checkboxes).toHaveCount(3);

		// Third checkbox ("Already done") should be checked
		await expect(checkboxes.nth(2)).toBeChecked();
		// First two should be unchecked
		await expect(checkboxes.nth(0)).not.toBeChecked();
		await expect(checkboxes.nth(1)).not.toBeChecked();
	});

	test("toggle task state saves to server", async ({ sbServer, page }) => {
		await page.goto(`${sbServer.url}/Tasks?enableSW=0`);
		await page.locator("#sb-editor .cm-editor").waitFor({ state: "visible", timeout: 30_000 });
		const editor = page.locator("#sb-editor .cm-content");

		await expect(editor).toContainText("Buy groceries");

		// Wait for checkboxes to render
		const firstCheckbox = page.locator(".sb-checkbox input[type='checkbox']").first();
		await expect(firstCheckbox).toBeVisible({ timeout: 10_000 });
		await expect(firstCheckbox).not.toBeChecked();

		// Click the first checkbox to toggle it
		await firstCheckbox.click();

		// Should now be checked
		await expect(firstCheckbox).toBeChecked();

		// Verify the change is saved to the server
		const content = await waitForSaveAndReadFromServer(page, sbServer, "Tasks.md");
		expect(content).toMatch(/\* \[x\] Buy groceries/);
	});
});
