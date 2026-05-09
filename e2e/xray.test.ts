import {
	expect,
	gotoSilverBulletPage,
	mod,
	test,
	waitForEditorReady,
} from "./fixtures.ts";

// Content designed so that indexing produces overlapping ranged objects at the
// wikilink position:
//
//   • `header`    from "# XRay Test" (range: full heading node)
//   • `paragraph` from the paragraph (range: full paragraph) — only indexed
//                 when it has a hashtag; #alpha satisfies that condition
//   • `link`      from [[Other]]       (range: the wikilink token only)
//   • `task`      from the task item   (range: task body)
//
// Hovering the rendered wikilink anchor (`.sb-wiki-link`) fires CodeMirror's
// hoverTooltip at the source position of `[[Other]]`, which falls inside both
// the `link` range and the wider `paragraph` range — so the stacked tooltip
// must contain both `tag: link` and `tag: paragraph`.
const XRAY_PAGE = `# XRay Test

This paragraph links to [[Other]] and has a tag. #alpha

* [ ] Task #beta #gamma
`;

test.describe("X-Ray lens", () => {
	test.use({
		spaceFiles: {
			"XRayTest.md": XRAY_PAGE,
			// Seed the link target so it doesn't become an aspiring page
			"Other.md": "# Other\nSome content.",
		},
	});

	test("underlines indexed ranges and shows stacked tooltip on wikilink hover, toggles off cleanly", async ({
		sbServer,
		page,
	}) => {
		await gotoSilverBulletPage(page, sbServer, "XRayTest");
		const editor = page.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("XRay Test");

		// Wait for the initial indexer pass so all ranged objects are available
		// when we activate X-Ray.
		await waitForEditorReady(page);

		const runToggle = async () => {
			await page.keyboard.press(`${mod}+/`);
			const modal = page.locator(".sb-modal-box");
			await expect(modal).toBeVisible();
			const paletteInput = modal.locator(".cm-content");
			await paletteInput.click();
			await page.keyboard.type("Toggle X-Ray", { delay: 30 });
			const option = modal.locator(".sb-option .sb-name", {
				hasText: "Toggle X-Ray",
			}).first();
			await expect(option).toBeVisible();
			await option.click();
			await expect(modal).not.toBeVisible();
		};

		// ── 1. Toggle X-Ray on via the command palette ────────────────────────
		await runToggle();

		// ── 2. At least one .sb-xray-range decoration must appear ─────────────
		await expect(page.locator(".sb-xray-range").first()).toBeVisible({
			timeout: 10_000,
		});

		// ── 3. Hover the wikilink and assert the stacked tooltip ──────────────
		// CodeMirror renders [[Other]] as a widget anchor (<a class="sb-wiki-link">).
		// Hovering it fires hoverTooltip at the underlying source position, which
		// falls inside both the `link` range and the outer `paragraph` range —
		// producing a stacked tooltip with entries for both objects.
		const wikiLink = page
			.locator(".sb-wiki-link", { hasText: "Other" })
			.first();
		await expect(wikiLink).toBeVisible({ timeout: 5_000 });
		await wikiLink.hover({ force: true });

		// X-Ray runs through CodeMirror's lint hover tooltip
		// (`.cm-tooltip-lint`); CM's hover has a built-in dwell delay, so wait
		// up to 5 s for it to appear.
		const tooltip = page.locator(".cm-tooltip-lint");
		await expect(tooltip).toBeVisible({ timeout: 5_000 });
		// Body assertions: the `link` and `paragraph` objects must appear in
		// the YAML rendered for their respective cards.
		await expect(tooltip).toContainText("tag: link");
		await expect(tooltip).toContainText("tag: paragraph");
		// Multi-tag expansion: the paragraph carries `#alpha`, so the index
		// pipeline emits the same paragraph object once under `paragraph` and
		// once under `alpha`. Same-object entries collapse into one card whose
		// header joins the tag names — exactly one `paragraph, alpha` header.
		await expect(
			tooltip.locator(".sb-xray-tooltip-tag", {
				hasText: /^paragraph, alpha$/,
			}),
		).toBeVisible();

		// ── 4. Toggle X-Ray off; all decorations must disappear ───────────────
		await runToggle();
		await expect(page.locator(".sb-xray-range")).toHaveCount(0, {
			timeout: 15_000,
		});
	});
});
