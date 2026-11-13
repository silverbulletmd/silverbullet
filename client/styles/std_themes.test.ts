import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_DARK_THEME,
  BUILTIN_LIGHT_THEME,
  themeInfoFromFrontmatter,
} from "../../plug-api/lib/themes.ts";

function readPage(path: string): string {
  return readFileSync(
    new URL(`../../libraries/${path}.md`, import.meta.url),
    "utf8",
  );
}

function frontmatter(page: string): Record<string, unknown> {
  const m = page.match(/^---\n([\s\S]*?)\n---\n/);
  return load(m![1]) as Record<string, unknown>;
}

describe("Std theme pages", () => {
  it("carry no styles: the client has both palettes built in", () => {
    for (const page of [BUILTIN_LIGHT_THEME, BUILTIN_DARK_THEME]) {
      expect(readPage(page)).not.toContain("```space-style");
    }
  });

  it("parse into their ThemeInfo", () => {
    expect(
      themeInfoFromFrontmatter(
        BUILTIN_LIGHT_THEME,
        frontmatter(readPage(BUILTIN_LIGHT_THEME)),
      ),
    ).toMatchObject({
      page: BUILTIN_LIGHT_THEME,
      displayName: "SilverBullet Light",
      scheme: "light",
      counterpart: BUILTIN_DARK_THEME,
    });
    expect(
      themeInfoFromFrontmatter(
        BUILTIN_DARK_THEME,
        frontmatter(readPage(BUILTIN_DARK_THEME)),
      ),
    ).toMatchObject({
      page: BUILTIN_DARK_THEME,
      displayName: "SilverBullet Dark",
      scheme: "dark",
      counterpart: BUILTIN_LIGHT_THEME,
    });
  });
});
