// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyFonts, fontCacheKey } from "./fonts.ts";

beforeEach(() => {
  document.head.innerHTML = "";
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { fonts?: unknown }).fonts;
});

/** A browser whose fonts load at once and whose "x" is `ascent`px of 100px. */
function fakeFontMetrics(ascent: (font: string) => number) {
  const loaded: string[] = [];
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      load: async (font: string) => {
        loaded.push(font);
        return [];
      },
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        font: "",
        measureText(this: { font: string }) {
          return { actualBoundingBoxAscent: ascent(this.font) };
        },
      }) as unknown as CanvasRenderingContext2D,
  );
  return loaded;
}

const sheet = () => document.getElementById("sb-fonts")!.textContent ?? "";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the editor font's x-height is measured once it has loaded, and cached", async () => {
  const loaded = fakeFontMetrics(() => 40.04);
  applyFonts({ editor: "Garamond, serif" });
  await settle();
  expect(loaded).toEqual(["100px Garamond, serif"]);
  expect(sheet()).toContain("--editor-font-x-height:0.4");
  expect(localStorage.getItem(fontCacheKey(document.baseURI))).toContain(
    "--editor-font-x-height:0.4",
  );
});

test("a remembered x-height is in the sheet at once, so reloads don't jump", async () => {
  fakeFontMetrics(() => 40);
  applyFonts({ editor: "Garamond, serif" });
  await settle();
  document.head.innerHTML = "";
  fakeFontMetrics(() => 40);
  applyFonts({ editor: "Garamond, serif" });
  expect(sheet()).toContain("--editor-font-x-height:0.4");
});

test("without font metrics, nothing is set", async () => {
  applyFonts({ editor: "Garamond, serif" });
  await settle();
  expect(sheet()).not.toContain("--editor-font-x-height");
});

test("a measurement for a font no longer selected is dropped", async () => {
  fakeFontMetrics((font) => (font.includes("Garamond") ? 40 : 55));
  applyFonts({ editor: "Garamond, serif" });
  applyFonts({ editor: "Inter, sans-serif" });
  await settle();
  expect(sheet()).toContain("--editor-font:Inter, sans-serif");
  expect(sheet()).toContain("--editor-font-x-height:0.55");
});

test("fonts applied with cache off show but leave the cache alone", () => {
  localStorage.setItem(fontCacheKey(document.baseURI), "cached");
  applyFonts({ editor: "Garamond, serif" }, { cache: false });
  expect(sheet()).toContain("--editor-font:Garamond, serif");
  expect(localStorage.getItem(fontCacheKey(document.baseURI))).toBe("cached");
});

test("remembered x-heights are kept per space", async () => {
  fakeFontMetrics(() => 40);
  applyFonts({ editor: "Garamond, serif" });
  await settle();
  // Another space, whose Garamond is a different file, hasn't measured it
  const other = document.implementation.createHTMLDocument();
  const base = other.createElement("base");
  base.href = "https://other.example/space/";
  other.head.append(base);
  applyFonts({ editor: "Garamond, serif" }, { doc: other });
  expect(other.getElementById("sb-fonts")!.textContent).not.toContain(
    "--editor-font-x-height",
  );
});
