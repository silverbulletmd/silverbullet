import { readFileSync } from "node:fs";
import {
  BUILTIN_FONTS,
  type FontEntry,
} from "@silverbulletmd/silverbullet/lib/fonts";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText, loadConfig } from "./boot_config.ts";

async function stdConfig(extraLua = "") {
  const lua = [
    "libraries/Library/Std/APIs/Schema.md",
    "libraries/Library/Std/Config.md",
  ]
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  return loadConfig(`${lua}\n${extraLua}`, {}, false);
}

test("Std registers the built-in fonts, with only the code font defaulted", async () => {
  const config = await stdConfig();
  expect(Object.keys(config.get("fonts.available", {})).sort()).toEqual([
    "ia-writer-mono",
    "inter",
    "system-mono",
    "system-sans",
    "system-serif",
  ]);
  expect(config.get("fonts.code", undefined)).toBe("ia-writer-mono");
  expect(config.get("fonts.editorSize", undefined)).toBe(18);
  expect(config.get("fonts.ui", undefined)).toBeUndefined();
  expect(config.get("fonts.editor", undefined)).toBeUndefined();
});

test("a library can add a font with faces", async () => {
  const config = await stdConfig(`
    config.set("fonts.available.literata", {
      name = "Literata",
      family = "Literata, Georgia, serif",
      kind = "serif",
      faces = { { src = "Library/Fonts/Literata/Literata-Regular.woff2", weight = 400 } },
      license = "OFL-1.1",
    })
  `);
  expect(config.get("fonts.available.literata.kind", undefined)).toBe("serif");
});

test("the font schema rejects an entry with an unknown kind", async () => {
  const config = await stdConfig();
  expect(() =>
    config.set("fonts.available.odd", {
      name: "Odd",
      family: "Odd",
      kind: "fancy",
    }),
  ).toThrow(/fonts.available/);
});

test("the built-ins for pages with no space match what Std registers", async () => {
  const config = await stdConfig();
  const std = config.get<Record<string, FontEntry>>("fonts.available", {});
  expect(
    Object.fromEntries(
      Object.entries(BUILTIN_FONTS).map(([k, f]) => [k, [f.family, f.kind]]),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.entries(std).map(([k, f]) => [k, [f.family, f.kind]]),
    ),
  );
});
