import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import {
  BasenameIndex,
  collisionIndex,
  type LinkWriteFormat,
  lookupIndex,
  rankCandidates,
  resolvePath,
  writeLinkPath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import { expect, test } from "vitest";
import fixture from "./resolve_path_fixture.json";

function index(...paths: string[]): BasenameIndex {
  const idx = new BasenameIndex();
  idx.rebuild(paths as Path[]);
  return idx;
}

// ---------------------------------------------------------------------------
// Bucket: MUST MATCH OBSIDIAN (derived from official Obsidian help docs)
// ---------------------------------------------------------------------------

test("must match Obsidian: bare name resolves space-wide by basename", () => {
  const idx = index("sub/folder/Notes.md", "Other.md");
  expect(resolvePath("Notes.md", "Other.md", idx)).toEqual({
    path: "sub/folder/Notes.md",
    exists: true,
    ambiguous: false,
  });
});

test("must match Obsidian: basename lookup is case-insensitive", () => {
  const idx = index("sub/Notes.md");
  expect(resolvePath("notes.md", "Other.md", idx).path).toEqual("sub/Notes.md");
  expect(resolvePath("NOTES.md", "Other.md", idx).path).toEqual("sub/Notes.md");
});

test("must match Obsidian: exact-case candidate beats case-insensitive one", () => {
  const idx = index("a/Notes.md", "b/notes.md");
  expect(resolvePath("notes.md", "z/Page.md", idx)).toEqual({
    path: "b/notes.md",
    exists: true,
    ambiguous: false,
  });
});

test("must match Obsidian: a path-qualified link is root-relative and exact", () => {
  const idx = index("sub/Notes.md", "other/Notes.md");
  expect(resolvePath("sub/Notes.md", "z/Page.md", idx)).toEqual({
    path: "sub/Notes.md",
    exists: true,
    ambiguous: false,
  });
});

test("must match Obsidian: a qualified path that does not exist stays literal", () => {
  const idx = index("sub/Notes.md");
  expect(resolvePath("other/Notes.md", "z/Page.md", idx)).toEqual({
    path: "other/Notes.md",
    exists: false,
    ambiguous: false,
  });
});

test("must match Obsidian: exact full-path match always wins over basename search", () => {
  // `Notes.md` exists at the root *and* in a subfolder: the literal path wins,
  // which also gives Obsidian's root-wins tie-break for free.
  const idx = index("Notes.md", "sub/Notes.md");
  expect(resolvePath("Notes.md", "sub/Page.md", idx).path).toEqual("Notes.md");
});

test("must match Obsidian: an unresolvable bare name stays literal at the root", () => {
  const idx = index("sub/Other.md");
  expect(resolvePath("Notes.md", "sub/Page.md", idx)).toEqual({
    path: "Notes.md",
    exists: false,
    ambiguous: false,
  });
});

test("must match Obsidian: documents resolve by basename too", () => {
  const idx = index("assets/diagram.png", "Page.md");
  expect(resolvePath("diagram.png", "Page.md", idx).path).toEqual(
    "assets/diagram.png",
  );
});

// ---------------------------------------------------------------------------
// Bucket: DELIBERATELY DIFFERS FROM OBSIDIAN
//
// Obsidian ranks the vault root ABOVE the linking page's own folder. We invert
// that: proximity first. Root-wins is what breaks location independence — open
// the parent of `docs/` and a link inside `docs/api/` would otherwise resolve
// to a sibling project's root-level file. Do not "fix" these back to parity.
// ---------------------------------------------------------------------------

test("deliberately differs: same folder beats another subfolder", () => {
  const idx = index("docs/api/Config.md", "sibling/Config.md");
  const result = resolvePath("Config.md", "docs/api/Auth.md", idx);
  expect(result.path).toEqual("docs/api/Config.md");
  expect(result.ambiguous).toBe(true);
});

test("deliberately differs: nearest common ancestor beats a distant folder", () => {
  const idx = index("docs/shared/Config.md", "sibling/Config.md");
  expect(resolvePath("Config.md", "docs/api/Auth.md", idx).path).toEqual(
    "docs/shared/Config.md",
  );
});

test("deliberately differs: the wide-root case resolves within its own subtree", () => {
  const idx = index(
    "docs/api/Config.md",
    "sibling/Config.md",
    "other/Config.md",
  );
  expect(resolvePath("Config.md", "docs/api/Auth.md", idx).path).toEqual(
    "docs/api/Config.md",
  );
});

test("a root-level file wins outright and is not flagged", () => {
  const idx = index("Config.md", "docs/api/Config.md");
  expect(resolvePath("Config.md", "docs/api/Auth.md", idx)).toEqual({
    path: "Config.md",
    exists: true,
    ambiguous: false,
  });
});

test("a qualified link is explicit and never ambiguous", () => {
  const idx = index("docs/api/Config.md", "sibling/Config.md");
  expect(resolvePath("docs/api/Config.md", "z/Page.md", idx)).toEqual({
    path: "docs/api/Config.md",
    exists: true,
    ambiguous: false,
  });
});

// ---------------------------------------------------------------------------
// Bucket: OBSIDIAN UNSPECIFIED — SilverBullet defines
// ---------------------------------------------------------------------------

test("silverbullet-defined: root wins once proximity ties, being shallowest", () => {
  const idx = index("Config.md", "guides/Config.md");
  expect(resolvePath("Config.md", "docs/api/Auth.md", idx).path).toEqual(
    "Config.md",
  );
});

test("silverbullet-defined: shallower path wins at equal proximity", () => {
  const idx = index("a/Config.md", "b/c/Config.md");
  expect(resolvePath("Config.md", "z/Page.md", idx).path).toEqual(
    "a/Config.md",
  );
});

test("silverbullet-defined: lexicographic order is the final tie-break", () => {
  const idx = index("b/Config.md", "a/Config.md");
  expect(resolvePath("Config.md", "z/Page.md", idx).path).toEqual(
    "a/Config.md",
  );
});

test("silverbullet-defined: same folder beats a descendant of the same folder", () => {
  const idx = index("docs/api/Config.md", "docs/api/deep/Config.md");
  expect(resolvePath("Config.md", "docs/api/Auth.md", idx).path).toEqual(
    "docs/api/Config.md",
  );
});

test("silverbullet-defined: ranking is deterministic and fully ordered", () => {
  const candidates: Path[] = [
    "sibling/Config.md",
    "Config.md",
    "docs/api/Config.md",
    "docs/shared/Config.md",
  ];
  expect(rankCandidates(candidates, "docs/api/Auth.md")).toEqual([
    "docs/api/Config.md",
    "docs/shared/Config.md",
    "Config.md",
    "sibling/Config.md",
  ]);
  // Input order must not affect the outcome.
  expect(rankCandidates([...candidates].reverse(), "docs/api/Auth.md")).toEqual(
    rankCandidates(candidates, "docs/api/Auth.md"),
  );
});

// ---------------------------------------------------------------------------
// The invariant, ambiguity reporting, and edge cases
// ---------------------------------------------------------------------------

test("a unique basename is never ambiguous and resolves the same from anywhere", () => {
  const idx = index("bla/Notes.md");
  for (const from of ["Page.md", "deep/nested/Page.md", "bla/Page.md"]) {
    expect(resolvePath("Notes.md", from as Path, idx)).toEqual({
      path: "bla/Notes.md",
      exists: true,
      ambiguous: false,
    });
  }
});

test("ambiguity reports every candidate, ranked", () => {
  const idx = index("bla/Notes.md", "bla2/Notes.md");
  const result = resolvePath("Notes.md", "bla/Page.md", idx);
  expect(result.ambiguous).toBe(true);
  expect(result.path).toEqual("bla/Notes.md");
  expect(result.candidates).toEqual(["bla/Notes.md", "bla2/Notes.md"]);
});

test("case-exact filtering collapses ambiguity", () => {
  const idx = index("a/Notes.md", "b/notes.md", "c/NOTES.md");
  const result = resolvePath("Notes.md", "z/Page.md", idx);
  expect(result.ambiguous).toBe(false);
  expect(result.path).toEqual("a/Notes.md");
});

test("the empty path resolves to the current page", () => {
  const idx = index("Page.md");
  expect(resolvePath("", "Page.md", idx)).toEqual({
    path: "",
    exists: true,
    ambiguous: false,
  });
});

test("the index tracks files incrementally", () => {
  const idx = new BasenameIndex();
  idx.rebuild(["bla/Notes.md"] as Path[]);
  expect(resolvePath("Notes.md", "Page.md", idx).ambiguous).toBe(false);

  idx.add("bla2/Notes.md" as Path);
  expect(resolvePath("Notes.md", "Page.md", idx).ambiguous).toBe(true);

  idx.delete("bla2/Notes.md" as Path);
  expect(resolvePath("Notes.md", "Page.md", idx)).toEqual({
    path: "bla/Notes.md",
    exists: true,
    ambiguous: false,
  });
});

test("basenames sharing a prefix are not confused", () => {
  const idx = index("a/Notes.md", "b/Notes Extra.md");
  expect(resolvePath("Notes.md", "z/Page.md", idx).path).toEqual("a/Notes.md");
});

// ---------------------------------------------------------------------------
// Write side and the round-trip property
// ---------------------------------------------------------------------------

test("shortest writes the bare name only when it is unique", () => {
  const idx = index("bla/Notes.md", "bla2/Other.md");
  expect(writeLinkPath("bla/Notes.md", "shortest", idx)).toEqual("Notes.md");
  expect(writeLinkPath("bla2/Other.md", "shortest", idx)).toEqual("Other.md");
});

test("shortest falls back to the full path when the name collides", () => {
  const idx = index("bla/Notes.md", "bla2/Notes.md");
  expect(writeLinkPath("bla/Notes.md", "shortest", idx)).toEqual(
    "bla/Notes.md",
  );
});

test("shortest qualifies when a root-level file shares the name", () => {
  const idx = index("Notes.md", "bla/Notes.md");
  expect(writeLinkPath("bla/Notes.md", "shortest", idx)).toEqual(
    "bla/Notes.md",
  );
});

test("full-path always writes the full path", () => {
  const idx = index("bla/Notes.md");
  expect(writeLinkPath("bla/Notes.md", "full-path", idx)).toEqual(
    "bla/Notes.md",
  );
});

test("round trip: every file, every format, from every page", () => {
  const files: Path[] = [
    "index.md",
    "Notes.md",
    "bla/Notes.md",
    "bla/Deep.md",
    "bla2/Notes.md",
    "docs/api/Config.md",
    "assets/diagram.png",
    // Suffix collisions: same basename, same parent folder name, and a file
    // sitting at the exact path a shorter suffix would name.
    "api/Auth.md",
    "docs/api/Auth.md",
    "sibling/api/Auth.md",
  ];
  const idx = index(...files);
  const formats: LinkWriteFormat[] = [
    "shortest",
    "shortest-suffix",
    "full-path",
  ];
  for (const target of files) {
    for (const format of formats) {
      const written = writeLinkPath(target, format, idx);
      for (const from of files) {
        expect({
          target,
          format,
          from,
          got: resolvePath(written, from, idx).path,
        }).toEqual({ target, format, from, got: target });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// lookupIndex: what sandboxed callers get through the syscall
// ---------------------------------------------------------------------------

function viaSyscall(paths: string[], requested: string[]) {
  const real = new BasenameIndex();
  real.rebuild(paths);
  const lookups: Record<string, any> = {};
  for (const path of requested) {
    lookups[path] = {
      exact: real.has(path),
      candidates: real.candidates(path.split("/").pop()!),
    };
  }
  return lookupIndex(lookups);
}

test("lookupIndex shortens a nested page, not just a root-level one", () => {
  const idx = viaSyscall(["bla/Notes.md", "Other.md"], ["bla/Notes.md"]);
  expect(writeLinkPath("bla/Notes.md", "shortest", idx)).toEqual("Notes.md");
});

test("lookupIndex still qualifies a colliding nested page", () => {
  const idx = viaSyscall(["bla/Notes.md", "bla2/Notes.md"], ["bla/Notes.md"]);
  expect(writeLinkPath("bla/Notes.md", "shortest", idx)).toEqual(
    "bla/Notes.md",
  );
});

test("lookupIndex resolves a bare link the same way the client does", () => {
  const idx = viaSyscall(["bla/Notes.md"], ["Notes.md"]);
  expect(resolvePath("Notes.md", "Home.md", idx)).toEqual({
    path: "bla/Notes.md",
    exists: true,
    ambiguous: false,
  });
});

test("lookupIndex reports an exact qualified path as existing", () => {
  const idx = viaSyscall(["bla/Notes.md"], ["bla/Notes.md"]);
  expect(resolvePath("bla/Notes.md", "Home.md", idx).exists).toBe(true);
});

test("a case-only rival does not make an exact match ambiguous", () => {
  // SilverBullet's own docs pair `Tag.md` with `Object/tag.md` and
  // `API/tag.md` on purpose. `[[Tag]]` matches one of them exactly.
  const idx = index("Tag.md", "Object/tag.md", "API/tag.md");
  expect(resolvePath("Tag.md", "Home.md", idx)).toEqual({
    path: "Tag.md",
    exists: true,
    ambiguous: false,
  });
});

test("ambiguity is only reported when a rewrite could resolve it", () => {
  // No root-level `Notes.md`, so the picker can write `bla/Notes` and clear it.
  const idx = index("bla/Notes.md", "bla2/Notes.md");
  expect(resolvePath("Notes.md", "Home.md", idx).ambiguous).toBe(true);
  // With a root-level file the link text is already the full path.
  const rooted = index("Notes.md", "bla/Notes.md");
  expect(resolvePath("Notes.md", "Home.md", rooted).ambiguous).toBe(false);
});

// ---------------------------------------------------------------------------
// Qualified links fall back to a path-suffix lookup
//
// This is what makes qualified links survive opening a space at a wider root:
// `[[api/Auth]]` written under a `docs/` root keeps working when the space is
// reopened at the parent and the file now lives at `docs/api/Auth.md`. It
// mirrors Obsidian accepting partial paths as linkpaths; the tie-break order
// is SilverBullet-defined (same proximity ranking as bare names).
// ---------------------------------------------------------------------------

test("a qualified link resolves by unique path suffix", () => {
  const idx = index("docs/api/Auth.md", "docs/guides/Intro.md");
  expect(resolvePath("api/Auth.md", "docs/Index.md", idx)).toEqual({
    path: "docs/api/Auth.md",
    exists: true,
    ambiguous: false,
  });
});

test("an exact path match beats a suffix match and is not ambiguous", () => {
  const idx = index("api/Auth.md", "docs/api/Auth.md");
  expect(resolvePath("api/Auth.md", "docs/Index.md", idx)).toEqual({
    path: "api/Auth.md",
    exists: true,
    ambiguous: false,
  });
});

test("several suffix matches are ambiguous and ranked by proximity", () => {
  const idx = index("docs/api/Auth.md", "sibling/api/Auth.md");
  const result = resolvePath("api/Auth.md", "docs/Index.md", idx);
  expect(result.ambiguous).toBe(true);
  expect(result.path).toEqual("docs/api/Auth.md");
  expect(result.candidates).toEqual([
    "docs/api/Auth.md",
    "sibling/api/Auth.md",
  ]);
});

test("suffix matching is case-insensitive with exact-case preference", () => {
  const idx = index("docs/API/Auth.md", "sibling/api/Auth.md");
  expect(resolvePath("api/Auth.md", "z/Page.md", idx)).toEqual({
    path: "sibling/api/Auth.md",
    exists: true,
    ambiguous: false,
  });
  const single = index("docs/API/Auth.md");
  expect(resolvePath("api/Auth.md", "z/Page.md", single).path).toEqual(
    "docs/API/Auth.md",
  );
});

test("a suffix only matches on a folder boundary", () => {
  const idx = index("xapi/Auth.md");
  expect(resolvePath("api/Auth.md", "z/Page.md", idx)).toEqual({
    path: "api/Auth.md",
    exists: false,
    ambiguous: false,
  });
});

test("a multi-segment suffix matches deep paths", () => {
  const idx = index("repo/docs/api/Auth.md", "repo/other/Auth.md");
  expect(resolvePath("docs/api/Auth.md", "Index.md", idx).path).toEqual(
    "repo/docs/api/Auth.md",
  );
});

test("documents resolve by path suffix too", () => {
  const idx = index("docs/assets/logo.png", "Page.md");
  expect(resolvePath("assets/logo.png", "docs/Page.md", idx).path).toEqual(
    "docs/assets/logo.png",
  );
});

test("lookupIndex resolves a qualified suffix link through the syscall shape", () => {
  const idx = viaSyscall(["docs/api/Auth.md"], ["api/Auth.md"]);
  expect(resolvePath("api/Auth.md", "Home.md", idx)).toEqual({
    path: "docs/api/Auth.md",
    exists: true,
    ambiguous: false,
  });
});

// ---------------------------------------------------------------------------
// Shared fixture: the same cases run against the Rust twin
// (server/src/link_resolve.rs), so the two resolvers cannot drift.
// ---------------------------------------------------------------------------

for (const c of fixture.cases) {
  test(`fixture: ${c.name}`, () => {
    const idx = index(...c.files);
    const result = resolvePath(c.link as Path, c.from as Path, idx);
    expect({
      path: result.path,
      exists: result.exists,
      ambiguous: result.ambiguous,
      ...(c.expect.ambiguous ? { candidates: result.candidates } : {}),
    }).toEqual(c.expect);
  });
}

// ---------------------------------------------------------------------------
// shortest-suffix write format
// ---------------------------------------------------------------------------

test("shortest-suffix writes bare when the name is unique", () => {
  const idx = index("bla/Notes.md", "Other.md");
  expect(writeLinkPath("bla/Notes.md", "shortest-suffix", idx)).toEqual(
    "Notes.md",
  );
});

test("shortest-suffix writes the minimal disambiguating suffix on collision", () => {
  const idx = index("docs/api/Auth.md", "sibling/Auth.md");
  expect(writeLinkPath("docs/api/Auth.md", "shortest-suffix", idx)).toEqual(
    "api/Auth.md",
  );
});

test("shortest-suffix grows the suffix until it is unique", () => {
  const idx = index("a/b/c/Auth.md", "z/c/Auth.md");
  expect(writeLinkPath("a/b/c/Auth.md", "shortest-suffix", idx)).toEqual(
    "b/c/Auth.md",
  );
});

test("a suffix shadowed by another file's exact path is skipped", () => {
  // "api/Auth" would resolve to the file actually at that path, not to the
  // deeper one, so the deeper target needs its full path.
  const idx = index("api/Auth.md", "docs/api/Auth.md");
  expect(writeLinkPath("docs/api/Auth.md", "shortest-suffix", idx)).toEqual(
    "docs/api/Auth.md",
  );
});

test("shortest-suffix falls back to the full path when nothing shorter is unique", () => {
  const idx = index("docs/api/Auth.md", "sibling/api/Auth.md");
  expect(writeLinkPath("docs/api/Auth.md", "shortest-suffix", idx)).toEqual(
    "docs/api/Auth.md",
  );
});

test("a colliding root-level target is its own shortest form", () => {
  const idx = index("Auth.md", "docs/Auth.md");
  expect(writeLinkPath("Auth.md", "shortest-suffix", idx)).toEqual("Auth.md");
});

// ---------------------------------------------------------------------------
// collisionIndex: the write-format decision from colliding buckets alone
// ---------------------------------------------------------------------------

test("collidingBuckets tracks collisions incrementally", () => {
  const idx = new BasenameIndex();
  idx.rebuild(["bla/Notes.md", "Other.md"] as Path[]);
  expect(idx.collidingBuckets()).toEqual({});

  idx.add("bla2/Notes.md" as Path);
  expect(idx.collidingBuckets()).toEqual({
    "notes.md": ["bla/Notes.md", "bla2/Notes.md"],
  });

  // Case variants collide on the same key.
  idx.add("c/NOTES.md" as Path);
  expect(idx.collidingBuckets()["notes.md"]).toHaveLength(3);

  idx.delete("bla2/Notes.md" as Path);
  idx.delete("c/NOTES.md" as Path);
  expect(idx.collidingBuckets()).toEqual({});
});

test("collisionIndex answers writeLinkPath exactly like the full index", () => {
  const files: Path[] = [
    "index.md",
    "Notes.md",
    "bla/Notes.md",
    "bla/Deep.md",
    "bla2/Notes.md",
    "docs/api/Config.md",
    "assets/diagram.png",
    "api/Auth.md",
    "docs/api/Auth.md",
    "sibling/api/Auth.md",
    "a/b/c/Twin.md",
    "z/c/Twin.md",
  ];
  const full = index(...files);
  const slim = collisionIndex(full.collidingBuckets());
  const formats: LinkWriteFormat[] = [
    "shortest",
    "shortest-suffix",
    "full-path",
  ];
  for (const target of files) {
    for (const format of formats) {
      expect({
        target,
        format,
        written: writeLinkPath(target, format, slim),
      }).toEqual({
        target,
        format,
        written: writeLinkPath(target, format, full),
      });
    }
  }
});
