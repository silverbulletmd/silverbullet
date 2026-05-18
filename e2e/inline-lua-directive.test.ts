// Regression guard: inline `${…}` lua directives must render inline,
// on the same visual line as the surrounding text. They were briefly
// broken onto their own line when a `width: 100%` rule on
// `.sb-lua-wrapper` (added to keep block directives editor-width)
// applied to inline wrappers too.

import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
	spaceFiles: {
		"Inline.md": `Add two numbers \${10 + 2} and continue.\n`,
	},
});

test("inline lua directive stays on the same line as surrounding text", async ({ sbServer, page }) => {
	await gotoSilverBulletPage(page, sbServer, "Inline");

	await page.waitForFunction(() => {
		return !!document.querySelector(
			"#sb-editor .sb-lua-wrapper .sb-lua-directive-inline",
		);
	}, undefined, { timeout: 10_000 });

	const layout = await page.evaluate(() => {
		const line = document.querySelector(
			"#sb-editor .cm-content .cm-line",
		) as HTMLElement;
		const wrapper = line.querySelector(".sb-lua-wrapper") as HTMLElement;
		const cs = getComputedStyle(line);
		return {
			lineHeight: line.getBoundingClientRect().height,
			defaultLineHeight: parseFloat(cs.lineHeight),
			lineWidth: line.getBoundingClientRect().width,
			wrapperWidth: wrapper.getBoundingClientRect().width,
		};
	});

	// The cm-line must remain a single visual line. If the inline
	// directive broke onto its own line, cm-line would be ≥2× the
	// editor's line-height (it would contain two stacked line boxes).
	expect(layout.lineHeight).toBeLessThan(layout.defaultLineHeight * 1.5);
	// And the wrapper must be shrink-to-fit, not the full content width.
	expect(layout.wrapperWidth).toBeLessThan(layout.lineWidth * 0.5);
});
