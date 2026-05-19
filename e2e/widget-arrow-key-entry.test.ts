// Regression guard: arrow keys must enter multi-line block widgets
// (queries, tables) one line at a time. The widget hides intermediate
// source lines with `display: none`, collapsing their geometry, which
// previously caused vertical motion to skip several document lines —
// ArrowDown landed on the last hidden line, ArrowUp on the first.

import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
	spaceFiles: {
		"QueryEntry.md": `Some intro text.

\${query[[
  from p = index.pages()
  order by p.name
  limit 3
]]}

Trailing text.
`,
		"TableEntry.md": `Some intro text.

| Header A | Header B |
|----------|----------|
| Cell A   | Cell B   |
| Cell A   | Cell B   |
| Cell A   | Cell B   |
| Cell A   | Cell B   |

Trailing text.
`,
	},
});

async function waitForBlockWidget(
	page: import("@playwright/test").Page,
	docLine: number,
) {
	await page.waitForFunction(
		(line) => {
			const v = (globalThis as any).client?.editorView;
			if (!v || v.state.doc.lines < line) return false;
			return v.lineBlockAt(v.state.doc.line(line).from).height > 10;
		},
		docLine,
		{ timeout: 10_000 },
	);
}

async function walk(
	page: import("@playwright/test").Page,
	startLine: number,
	key: "ArrowUp" | "ArrowDown",
	steps: number,
) {
	return await page.evaluate(
		async (args) => {
			const v = (globalThis as any).client.editorView;
			v.focus();
			v.dispatch({
				selection: { anchor: v.state.doc.line(args.startLine).from },
			});
			await new Promise((r) => setTimeout(r, 50));
			const trail: number[] = [
				v.state.doc.lineAt(v.state.selection.main.head).number,
			];
			for (let i = 0; i < args.steps; i++) {
				const ev = new KeyboardEvent("keydown", {
					key: args.key,
					bubbles: true,
					cancelable: true,
				});
				v.contentDOM.dispatchEvent(ev);
				await new Promise((r) => setTimeout(r, 20));
				trail.push(
					v.state.doc.lineAt(v.state.selection.main.head).number,
				);
			}
			return trail;
		},
		{ startLine, key, steps },
	);
}

test("ArrowDown enters multi-line query block at its first source line", async ({
	sbServer,
	page,
}) => {
	await gotoSilverBulletPage(page, sbServer, "QueryEntry");
	await waitForBlockWidget(page, 3); // `${query[[` line

	const trail = await walk(page, 2, "ArrowDown", 5);
	// From the blank line (2) descend into lines 3..7 one at a time.
	expect(trail).toEqual([2, 3, 4, 5, 6, 7]);
});

test("ArrowUp enters multi-line query block at its last source line", async ({
	sbServer,
	page,
}) => {
	await gotoSilverBulletPage(page, sbServer, "QueryEntry");
	await waitForBlockWidget(page, 3);

	// Line 9 is the blank line after `]]}` (line 8).
	const trail = await walk(page, 9, "ArrowUp", 6);
	expect(trail).toEqual([9, 8, 7, 6, 5, 4, 3]);
});

test("ArrowUp enters multi-line table at its last row", async ({
	sbServer,
	page,
}) => {
	await gotoSilverBulletPage(page, sbServer, "TableEntry");
	await waitForBlockWidget(page, 3); // table header line

	// Line 9 is blank line after the table body (lines 3-8).
	const trail = await walk(page, 9, "ArrowUp", 6);
	expect(trail).toEqual([9, 8, 7, 6, 5, 4, 3]);
});

test("ArrowDown enters multi-line table at its first row", async ({
	sbServer,
	page,
}) => {
	await gotoSilverBulletPage(page, sbServer, "TableEntry");
	await waitForBlockWidget(page, 3);

	const trail = await walk(page, 2, "ArrowDown", 5);
	expect(trail).toEqual([2, 3, 4, 5, 6, 7]);
});
