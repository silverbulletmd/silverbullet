import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import {
  parseDimensionFromAlias,
  parseTransclusion,
  resolveTransclusionUrl,
  type Transclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import { expect, test } from "vitest";

test.each([
  ["30%", "", { width: "30%" }],
  ["Sample|12.5%", "Sample", { width: "12.5%" }],
  [".5%", "", { width: ".5%" }],
  ["30%x200", "", { width: "30%", height: 200 }],
  ["Sample|30%x200", "Sample", { width: "30%", height: 200 }],
  ["300", "", { width: 300 }],
  ["x200", "", { height: 200 }],
  ["Sample|300x200", "Sample", { width: 300, height: 200 }],
])("parses media dimensions in %s", (text, alias, dimension) => {
  expect(parseDimensionFromAlias(text)).toEqual({ alias, dimension });
});

test.each(["30%extra", "30%%", "-30%", "x30%", "Sample|x30%"])(
  "does not interpret unsupported percentages in %s as pixels",
  (text) => {
    const { dimension } = parseDimensionFromAlias(text);
    expect(dimension?.width).toBeUndefined();
    expect(dimension?.height).toBeUndefined();
  },
);

test.each(["![[image.png|30%]]", "![Sample|30%](image.png)"])(
  "preserves percentage widths in %s",
  (text) => {
    expect(parseTransclusion(text)?.dimension).toEqual({ width: "30%" });
  },
);

function index(...paths: string[]): BasenameIndex {
  const idx = new BasenameIndex();
  idx.rebuild(paths as Path[]);
  return idx;
}

function transclude(text: string): Transclusion {
  const t = parseTransclusion(text);
  if (!t) {
    throw new Error(`Did not parse: ${text}`);
  }
  return t;
}

test("a bare page embed resolves like a wiki link", () => {
  const t = transclude("![[Note]]");
  resolveTransclusionUrl(t, "Home.md", index("sub/Note.md", "Home.md"));
  expect(t.url).toEqual("sub/Note");
});

test("a bare document embed resolves like a wiki link", () => {
  const t = transclude("![[diagram.png]]");
  resolveTransclusionUrl(t, "Home.md", index("assets/diagram.png", "Home.md"));
  expect(t.url).toEqual("assets/diagram.png");
});

test("a header suffix survives resolution", () => {
  const t = transclude("![[Note#Section]]");
  resolveTransclusionUrl(t, "Home.md", index("sub/Note.md"));
  expect(t.url).toEqual("sub/Note#Section");
});

test("an exact path is left as written", () => {
  const t = transclude("![[sub/Note]]");
  resolveTransclusionUrl(t, "Home.md", index("sub/Note.md"));
  expect(t.url).toEqual("sub/Note");
});

test("an unresolvable target stays literal", () => {
  const t = transclude("![[Nowhere]]");
  resolveTransclusionUrl(t, "Home.md", index("Home.md"));
  expect(t.url).toEqual("Nowhere");
});

test("a markdown-link embed keeps its folder-relative meaning", () => {
  const t = transclude("![alt](diagram.png)");
  resolveTransclusionUrl(
    t,
    "docs/Home.md",
    index("assets/diagram.png", "docs/Home.md"),
  );
  expect(t.url).toEqual("diagram.png");
});

test("an ambiguous embed resolves to the ranking winner", () => {
  const t = transclude("![[Note]]");
  resolveTransclusionUrl(
    t,
    "docs/Home.md",
    index("docs/Note.md", "sibling/Note.md"),
  );
  expect(t.url).toEqual("docs/Note");
});
