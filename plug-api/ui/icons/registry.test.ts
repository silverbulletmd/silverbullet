import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  configureIcons,
  iconNames,
  iconSvg,
  iconSvgOrNull,
  loadIcons,
  onIconsLoaded,
  resolveIconName,
} from "./registry.ts";
import type { IconData } from "./types.ts";

const path = (d: string): [string, Record<string, string>] => ["path", { d }];

const fixture: IconData = {
  icons: {
    book: [path("M1 1")],
    house: [path("M2 2")],
    "square-check": [path("M3 3")],
    "circle-question-mark": [path("M4 4")],
    "zap-off": [path("M5 5")],
  },
  aliases: { "check-square": "square-check" },
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  configureIcons({ data: fixture });
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

test("names are trimmed, lowercased and stripped of feather:", () => {
  expect(resolveIconName(" Book ")).toBe("book");
  expect(resolveIconName("BOOK")).toBe("book");
  expect(resolveIconName("feather:book")).toBe("book");
});

test("Lucide aliases and deprecated names resolve to canonical names", () => {
  expect(resolveIconName("check-square")).toBe("square-check");
  expect(resolveIconName("md-home")).toBe("house");
});

test("unknown, brand, non-string and markup values resolve to nothing", () => {
  for (const value of [
    "github",
    "nope",
    null,
    undefined,
    42,
    {},
    "",
    "<svg onload=alert(1)>",
  ]) {
    expect(resolveIconName(value), String(value)).toBeUndefined();
  }
});

test("an unknown name renders the fallback glyph", () => {
  expect(iconSvg("nope")).toContain("lucide-circle-question-mark");
});

test("markup is never passed through", () => {
  const svg = iconSvg("<svg onload=x>");
  expect(svg).not.toContain("onload");
  expect(svg).toContain("lucide-circle-question-mark");
});

test("a non-string value renders nothing", () => {
  expect(iconSvg(42)).toBe("");
  expect(iconSvg(undefined)).toBe("");
});

test("a resolved icon renders Lucide's stroke svg", () => {
  const svg = iconSvg("book");
  expect(svg).toContain("lucide-book");
  expect(svg).toContain('viewBox="0 0 24 24"');
  expect(svg).toContain('stroke="currentColor"');
  expect(svg).toContain('d="M1 1"');
});

test("attribute values are escaped", () => {
  configureIcons({
    data: { icons: { x: [["path", { d: '"><script>' }]] }, aliases: {} },
  });
  expect(iconSvg("x")).not.toContain("<script>");
});

test("a deprecated name warns once, naming its replacement", () => {
  iconSvg("md-home");
  iconSvg("md-home");
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toContain("house");
});

test("iconSvgOrNull returns null for unknown names", () => {
  expect(iconSvgOrNull("nope")).toBeNull();
  expect(iconSvgOrNull("book")).toContain("lucide-book");
});

test("iconNames lists canonical names, sorted", () => {
  expect(iconNames()).toEqual([
    "book",
    "circle-question-mark",
    "house",
    "square-check",
    "zap-off",
  ]);
});

test("before the full set loads, a non-core name is an empty placeholder; a failed load falls back", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  );
  configureIcons({ url: "/.client/icons.json" });
  const placeholder = iconSvg("zap-off");
  expect(placeholder).toContain("<svg");
  expect(placeholder).not.toContain("<path");
  expect(iconSvg("tag")).toContain("lucide-tag");
  await loadIcons();
  expect(iconSvg("zap-off")).toContain("lucide-circle-question-mark");
  expect(iconSvg("tag")).toContain("lucide-tag");
});

test("onIconsLoaded fires after a successful load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })),
    ),
  );
  configureIcons({ url: "/.client/icons.json" });
  const listener = vi.fn();
  onIconsLoaded(listener);
  await loadIcons();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(iconSvg("zap-off")).toContain("lucide-zap-off");
});
