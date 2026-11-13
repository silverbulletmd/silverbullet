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
// Ranking: proximity first. Obsidian ranks the vault root ABOVE the linking
// page's own folder; we invert that, since root-wins breaks location
// independence. Do not "fix" these back to parity. Most resolution cases live
// in resolve_path_fixture.json (shared with the Rust twin).
// ---------------------------------------------------------------------------

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

test("a [[CONFIG]] link follows the config page to Library/Config", () => {
  // Std's own Library/Std/Config makes the bare name ambiguous; the
  // shallower Library/Config wins
  const idx = index("index.md", "Library/Config.md", "Library/Std/Config.md");
  for (const from of ["index.md", "Notes/Deep/Page.md"] as Path[]) {
    expect(resolvePath("CONFIG.md", from, idx)).toMatchObject({
      path: "Library/Config.md",
      exists: true,
      ambiguous: true,
    });
  }
});
