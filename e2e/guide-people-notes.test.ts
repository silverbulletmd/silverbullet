import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

// This file exercises the workflow described in website/Guide/People Notes.md
// end-to-end. It seeds a small CRM-style space and verifies the load-bearing
// claims of the guide:
//   - person pages are tagged via frontmatter
//   - meeting notes that link to a person show up in that person's
//     Linked Mentions widget
//   - tasks that mention a person show up in that person's Linked Tasks widget
//   - a Lua-integrated query over `tags.person` returns matching person pages

const ALICE = `---
tags: person
company: Acme Corp
---
Alice is the engineering lead at [[Acme Corp]].
`;

const BOB = `---
tags: person
company: Acme Corp
---
Bob handles design at [[Acme Corp]].
`;

const MEETING_NOTE = `# Meeting/2026-03-04
Met with [[Alice]] and [[Bob]] to discuss the Q2 roadmap. Alice will lead the backend migration.

* [ ] Send proposal to [[Alice]]
* [ ] Schedule follow-up with [[Bob]]
`;

// A People dashboard page that uses the query the guide shows for grouping
// people by company.
const PEOPLE_PAGE = `# People
\${template.each(query[[
  from p = tags.person
  order by p.company
]], templates.pageItem)}
`;

test.describe("Guide: People Notes", () => {
	test.use({
		spaceFiles: {
			"index.md": "# Welcome\nThis is the index.",
			"Alice.md": ALICE,
			"Bob.md": BOB,
			"Meeting/2026-03-04.md": MEETING_NOTE,
			"People.md": PEOPLE_PAGE,
		},
	});

	test("person page surfaces meeting note as a Linked Mention", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Alice");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Alice");

		// Linked Mentions section appears at the bottom and includes the meeting note
		await expect(editor).toContainText("Linked Mentions", { timeout: 15_000 });
		await expect(editor).toContainText("Met with");
	});

	test("person page surfaces incomplete tasks as Linked Tasks", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "Alice");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Alice");

		// The Linked Tasks widget appears at the top of the page and shows
		// "Send proposal to Alice" — an incomplete task from the meeting note
		// that mentions [[Alice]].
		await expect(editor).toContainText("Linked Tasks", { timeout: 15_000 });
		await expect(editor).toContainText("Send proposal to");
	});

	test("query over tags.person returns all person pages", async ({ sbPage, sbServer }) => {
		await gotoSilverBulletPage(sbPage, sbServer, "People");
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("People");

		// The query widget should render Alice and Bob as result items
		await expect(editor).toContainText("Alice", { timeout: 20_000 });
		await expect(editor).toContainText("Bob");
	});
});
