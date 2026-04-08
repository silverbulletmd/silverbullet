import {
	expect,
	gotoSilverBulletPage,
	test,
	waitForSaveAndReadFromServer,
} from "./fixtures.ts";

// This file exercises the workflow described in website/Guide/Task Management.md
// end-to-end. It seeds a small project + task space and verifies the
// load-bearing claims of the guide:
//   - tasks on a project page render with checkboxes
//   - tasks scattered across other pages that link back to a project show up
//     in the project's Linked Tasks widget
//   - clicking a checkbox persists the new state to disk
//   - a query over `tags.project` returns project pages
//   - a query over `tags.task where not t.done` returns open tasks

const WEBSITE_REDESIGN = `---
tags: project
status: active
priority: high
---
# Website Redesign

A redesign of the marketing website.

* [ ] Write the project proposal
* [ ] Create wireframes
* [ ] Set up staging environment
`;

const MEETING_NOTE = `# Meeting Notes/2026-03-04
* [ ] Send updated mockups to client [[Website Redesign]]
* [ ] Schedule review meeting [[Website Redesign]]
`;

const DASHBOARD = `# Dashboard

# Active projects
\${query[[from p = tags.project where p.status == "active"]]}

# Open tasks
\${template.each(query[[
  from t = tags.task
  where not t.done
  order by t.lastModified desc
  limit 10
]], templates.taskItem)}
`;

test.describe("Guide: Task Management", () => {
	test.use({
		spaceFiles: {
			"index.md": "# Welcome\nThis is the index.",
			"Website Redesign.md": WEBSITE_REDESIGN,
			"Meeting Notes/2026-03-04.md": MEETING_NOTE,
			"Dashboard.md": DASHBOARD,
		},
	});

	test("project page renders task checkboxes", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Website Redesign");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Website Redesign");

		const checkboxes = sbPage.locator(
			"#sb-editor .cm-content .sb-checkbox input[type='checkbox']",
		);
		await expect(checkboxes.first()).toBeVisible({ timeout: 10_000 });
		// Three native tasks; linked tasks may add more, so just assert >= 3
		const count = await checkboxes.count();
		expect(count).toBeGreaterThanOrEqual(3);
	});

	test("project page surfaces tasks scattered across other pages as Linked Tasks", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Website Redesign");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Website Redesign");

		await expect(editor).toContainText("Linked Tasks", { timeout: 15_000 });
		// Tasks from Meeting Notes/2026-03-04 that link to [[Website Redesign]]
		await expect(editor).toContainText("Send updated mockups");
		await expect(editor).toContainText("Schedule review meeting");
	});

	test("toggling a task on the project page persists to disk", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Website Redesign");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Write the project proposal");

		// Click the first checkbox in the editor body
		const firstCheckbox = editor.locator(".sb-checkbox input[type='checkbox']").first();
		await expect(firstCheckbox).toBeVisible({ timeout: 10_000 });
		await expect(firstCheckbox).not.toBeChecked();
		await firstCheckbox.click();
		await expect(firstCheckbox).toBeChecked();

		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Website Redesign.md");
		expect(content).toMatch(/\* \[x\] Write the project proposal/);
	});

	test("dashboard query renders active projects and open tasks", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Dashboard");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Dashboard");

		// "Active projects" section should list Website Redesign
		await expect(editor).toContainText("Website Redesign", { timeout: 20_000 });
		// "Open tasks" section should include at least one of our seeded tasks
		await expect(editor).toContainText("Write the project proposal");
	});
});
