import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import {
  parseTransclusion,
  resolveTransclusionUrl,
  type Transclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import { expect, test } from "vitest";

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
