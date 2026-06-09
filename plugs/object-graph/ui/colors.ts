// Color used for nodes/swatches with no user tag. The CSS custom
// property is defined in the stylesheet; the hex is the static fallback
// for canvas drawing (which can't resolve vars).
export const UNTAGGED_COLOR_VAR = "var(--gv-untagged, #9e9e9e)";

// Deterministic color per user tag: stable hash → HSL hue with fixed
// saturation and lightness. `null` (no tag) returns the untagged fallback.
export function colorForTag(tag: string | null): string {
	if (!tag) return UNTAGGED_COLOR_VAR;
	let h = 0;
	for (let i = 0; i < tag.length; i++) {
		h = (h * 31 + tag.charCodeAt(i)) >>> 0;
	}
	return `hsl(${h % 360} 60% 55%)`;
}
