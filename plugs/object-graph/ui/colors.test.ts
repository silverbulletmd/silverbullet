import { describe, expect, it } from "vitest";
import { colorForTag, UNTAGGED_COLOR_VAR } from "./colors.ts";

describe("colorForTag", () => {
	it("returns the untagged CSS variable for null", () => {
		expect(colorForTag(null)).toBe(UNTAGGED_COLOR_VAR);
	});

	it("is deterministic — same tag yields the same color", () => {
		expect(colorForTag("driver")).toBe(colorForTag("driver"));
		expect(colorForTag("research")).toBe(colorForTag("research"));
	});

	it("produces different colors for distinct tags (typically)", () => {
		// Hash collisions are possible in principle; the F1 demo tags do not collide.
		expect(colorForTag("driver")).not.toBe(colorForTag("team"));
		expect(colorForTag("driver")).not.toBe(colorForTag("person"));
	});

	it("returns hsl() strings", () => {
		expect(colorForTag("anything")).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
	});
});
