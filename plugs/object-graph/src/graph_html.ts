import { asset } from "@silverbulletmd/silverbullet/syscalls";
import { panelStyles } from "@silverbulletmd/silverbullet/ui";
import type { RootViewModel } from "./model.ts";

const PLUG_NAME = "object-graph";

export async function buildGraphHtml(
	view: RootViewModel,
): Promise<{ html: string; script: string }> {
	const [preamble, css, jsTemplate] = await Promise.all([
		// Shared component stylesheet (`.sb-*`) + the user's space styles, so the
		// standard UI components render themed; our own CSS is appended after so
		// it stays highest-precedence for graph-specific styling.
		panelStyles(),
		asset.readAsset(PLUG_NAME, "assets/object-graph.css"),
		asset.readAsset(PLUG_NAME, "assets/object-graph.js"),
	]);

	const html =
		`${preamble}<style>${css}</style><div id="graph-root" tabindex="-1"></div>`;

	// `var` (not `const`) so the declaration hoists into the eval'd scope and
	// is lexically visible to the IIFE the bundled script wraps us in.
	const script = `var __GRAPH = ${JSON.stringify(view)};\n${jsTemplate}`;

	return { html, script };
}
