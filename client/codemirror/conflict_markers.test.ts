import { EditorState, Text } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import type { Client } from "../client.ts";
import {
  type ConflictHunk,
  ConflictWidget,
  computeFenceMask,
  conflictMarkers,
  findConflictHunks,
  resolveHunk,
  sectionTitle,
  shouldRenderBasePanel,
  truncateLabel,
} from "./conflict_markers.ts";

function docOf(text: string) {
  return EditorState.create({ doc: text }).doc;
}

describe("findConflictHunks — SB grammar", () => {
  test("finds a well-formed single hunk with exact offsets and hashes", () => {
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
      "after\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toEqual([
      {
        from: text.indexOf("<<<<<<<"),
        to: text.indexOf("after"),
        kind: "sb",
        first: {
          from: text.indexOf("mine"),
          to: text.indexOf("|||||||"),
          hash: "aaa111",
          label: undefined,
          text: "mine\n",
        },
        base: {
          from: text.indexOf("root"),
          to: text.indexOf("======="),
          hash: "ccc222",
          label: undefined,
          text: "root\n",
        },
        second: {
          from: text.indexOf("theirs"),
          to: text.indexOf(">>>>>>>"),
          hash: "bbb333",
          label: undefined,
          text: "theirs\n",
        },
      },
    ]);
  });

  test("finds two separate hunks", () => {
    const text = [
      "one\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mineA\n",
      "||||||| SB BASE sha256:ccc222\n",
      "rootA\n",
      "=======\n",
      "theirsA\n",
      ">>>>>>> SB sha256:bbb333\n",
      "two\n",
      "<<<<<<< SB sha256:ddd444\n",
      "mineB\n",
      "||||||| SB BASE sha256:fff666\n",
      "rootB\n",
      "=======\n",
      "theirsB\n",
      ">>>>>>> SB sha256:eee555\n",
      "three\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(2);
    expect(hunks[0].first.hash).toBe("aaa111");
    expect(hunks[0].second.hash).toBe("bbb333");
    expect(hunks[0].first.text).toBe("mineA\n");
    expect(hunks[1].first.hash).toBe("ddd444");
    expect(hunks[1].second.hash).toBe("eee555");
    expect(hunks[1].base!.text).toBe("rootB\n");
    expect(hunks[0].to).toBeLessThan(hunks[1].from);
  });

  test("handles CRLF line endings, stripping the trailing CR for detection only", () => {
    // `EditorState.create` normalizes "\r\n" away on construction, so a plain
    // string wouldn't exercise the CR-stripping path. Building the `Text`
    // from pre-split lines (each carrying a literal trailing "\r") is how a
    // CRLF document's lines actually look once loaded into CodeMirror.
    const doc = Text.of([
      "before\r",
      "<<<<<<< SB sha256:aaa111\r",
      "mine\r",
      "||||||| SB BASE sha256:ccc222\r",
      "root\r",
      "=======\r",
      "theirs\r",
      ">>>>>>> SB sha256:bbb333\r",
      "after\r",
    ]);

    const hunks = findConflictHunks(doc);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].first.hash).toBe("aaa111");
    expect(hunks[0].base!.hash).toBe("ccc222");
    expect(hunks[0].second.hash).toBe("bbb333");
    expect(hunks[0].first.text).toBe("mine\r\n");
    expect(hunks[0].base!.text).toBe("root\r\n");
    expect(hunks[0].second.text).toBe("theirs\r\n");
  });

  test("ignores a lone separator with no preceding start marker", () => {
    const text = ["\n", "=======\n", "not a hunk\n"].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  test("yields nothing for an unterminated hunk (no closing marker)", () => {
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      "no closing marker here\n",
    ].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  test("finds a hunk at EOF with no trailing newline", () => {
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].to).toBe(text.length);
    expect(hunks[0].second.text).toBe("theirs\n");
  });

  test("finds a hunk that straddles the frontmatter fence", () => {
    const text = [
      "---\n",
      "title: Test\n",
      "<<<<<<< SB sha256:aaa111\n",
      "tags: [x]\n",
      "||||||| SB BASE sha256:ccc222\n",
      "tags: []\n",
      "=======\n",
      "tags: [y]\n",
      ">>>>>>> SB sha256:bbb333\n",
      "---\n",
      "Body content\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].from).toBe(text.indexOf("<<<<<<<"));
    expect(hunks[0].to).toBe(text.indexOf("---\nBody"));
    expect(hunks[0].first.text).toBe("tags: [x]\n");
    expect(hunks[0].base!.text).toBe("tags: []\n");
    expect(hunks[0].second.text).toBe("tags: [y]\n");
  });

  test("aborts the whole block on a nested start marker (malformed, no hunk)", () => {
    // A second "<<<<<<< SB sha256:" line before the outer hunk's close is
    // damage the server never produces. Naively swallowing it into
    // `first.text` would let "Accept first" leave a stray marker line
    // behind, so the whole span through the nested marker is abandoned.
    const text = [
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "<<<<<<< SB sha256:zzz999\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
    ].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  // SB's grammar can't false-positive (a full sha256 hex marker line is
  // never accidental), so fence-masking must never suppress it — unlike
  // git hunks, which the fenced-example tests below confirm ARE masked.
  test("finds an SB hunk whose sides contain fence openers", () => {
    const text = [
      "<<<<<<< SB sha256:aaa111\n",
      "```js\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "```js\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].kind).toBe("sb");
    expect(hunks[0].first.text).toBe("```js\nmine\n");
    expect(hunks[0].second.text).toBe("```js\ntheirs\n");
  });

  test("finds an SB hunk that follows an earlier unclosed fence", () => {
    const text = [
      "Docs:\n",
      "```\n",
      "example, never closed\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].first.text).toBe("mine\n");
    expect(hunks[0].second.text).toBe("theirs\n");
  });
});

describe("findConflictHunks — git grammar", () => {
  test("finds a git two-way hunk (no diff3 base)", () => {
    const text = [
      "before\n",
      "<<<<<<< HEAD\n",
      "mine\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature-branch\n",
      "after\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].kind).toBe("git");
    expect(hunks[0].base).toBeUndefined();
    expect(hunks[0].first).toEqual({
      from: text.indexOf("mine"),
      to: text.indexOf("======="),
      hash: "",
      label: "HEAD",
      text: "mine\n",
    });
    expect(hunks[0].second).toEqual({
      from: text.indexOf("theirs"),
      to: text.indexOf(">>>>>>>"),
      hash: "",
      label: "feature-branch",
      text: "theirs\n",
    });
    expect(hunks[0].from).toBe(text.indexOf("<<<<<<<"));
    expect(hunks[0].to).toBe(text.indexOf("after"));
  });

  test("finds a git diff3 hunk with a base section", () => {
    const text = [
      "<<<<<<< HEAD\n",
      "mine\n",
      "||||||| merged common ancestors\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature-branch\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].kind).toBe("git");
    expect(hunks[0].base).toEqual({
      from: text.indexOf("root"),
      to: text.indexOf("======="),
      hash: "",
      label: "merged common ancestors",
      text: "root\n",
    });
  });

  test("captures a bare start marker with no label at all", () => {
    const text = [
      "<<<<<<<\n",
      "mine\n",
      "=======\n",
      "theirs\n",
      ">>>>>>>\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].first.label).toBe("");
    expect(hunks[0].second.label).toBe("");
  });

  test("yields nothing for a bare '<<<<<<< HEAD' with no closing sequence", () => {
    const text = ["<<<<<<< HEAD\n", "some text\n", "more text\n"].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  test("yields nothing for an incomplete git hunk (missing the end marker)", () => {
    const text = [
      "<<<<<<< HEAD\n",
      "mine\n",
      "=======\n",
      "theirs\n",
      "no closing marker\n",
    ].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  test("nested-start abort applies to a git hunk too", () => {
    const text = [
      "<<<<<<< HEAD\n",
      "mine\n",
      "<<<<<<< nested\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature\n",
    ].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  test("ignores a fenced code block containing a full git conflict example", () => {
    const text = [
      "Some docs about resolving conflicts:\n",
      "\n",
      "```\n",
      "<<<<<<< HEAD\n",
      "mine\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature-branch\n",
      "```\n",
      "\n",
      "The rest of the page.\n",
    ].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });

  test("ignores a fenced example but still finds a real hunk elsewhere", () => {
    const text = [
      "```\n",
      "<<<<<<< HEAD\n",
      "example\n",
      "=======\n",
      "example2\n",
      ">>>>>>> branch\n",
      "```\n",
      "\n",
      "<<<<<<< HEAD\n",
      "real mine\n",
      "=======\n",
      "real theirs\n",
      ">>>>>>> real-branch\n",
    ].join("");

    const hunks = findConflictHunks(docOf(text));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].first.text).toBe("real mine\n");
  });

  test("ignores a tilde-fenced code block too", () => {
    const text = [
      "~~~\n",
      "<<<<<<< HEAD\n",
      "mine\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature\n",
      "~~~\n",
    ].join("");

    expect(findConflictHunks(docOf(text))).toEqual([]);
  });
});

describe("computeFenceMask", () => {
  test("an unclosed fence masks every line through EOF", () => {
    const text = ["```", "line1", "line2", "line3"].join("\n");
    const mask = computeFenceMask(docOf(text));
    expect(mask[1]).toBe(false); // the opening delimiter itself
    expect(mask[2]).toBe(true);
    expect(mask[3]).toBe(true);
    expect(mask[4]).toBe(true);
  });

  test("a fence indented by up to 3 spaces still counts as a fence", () => {
    const text = ["   ```", "hidden", "   ```", "visible"].join("\n");
    const mask = computeFenceMask(docOf(text));
    expect(mask[1]).toBe(false);
    expect(mask[2]).toBe(true);
    expect(mask[3]).toBe(false); // closing delimiter
    expect(mask[4]).toBe(false); // after the fence closes
  });

  // The boundary CommonMark itself draws: 4+ leading spaces is an indented
  // code block, a different mechanism this pass doesn't track at all (see
  // the "known limitation" note in the task report) — not a fence opener.
  test("4+ leading spaces does not open a fence", () => {
    const text = ["    ```", "not inside a fence"].join("\n");
    const mask = computeFenceMask(docOf(text));
    expect(mask[1]).toBe(false);
    expect(mask[2]).toBe(false);
  });

  test("an opening fence may carry an info string", () => {
    const text = ["```js", "const x = 1;", "```", "after"].join("\n");
    const mask = computeFenceMask(docOf(text));
    expect(mask[1]).toBe(false);
    expect(mask[2]).toBe(true);
    expect(mask[3]).toBe(false);
    expect(mask[4]).toBe(false);
  });

  test("a tilde fence is not closed by a backtick fence", () => {
    const text = ["~~~", "```", "still inside", "~~~", "after"].join("\n");
    const mask = computeFenceMask(docOf(text));
    expect(mask[1]).toBe(false);
    expect(mask[2]).toBe(true);
    expect(mask[3]).toBe(true);
    expect(mask[4]).toBe(false); // the matching ~~~ closer
    expect(mask[5]).toBe(false);
  });
});

describe("resolveHunk", () => {
  function makeHunk(overrides: Partial<ConflictHunk> = {}): ConflictHunk {
    return {
      from: 100,
      to: 200,
      kind: "sb",
      first: { from: 110, to: 120, hash: "aaa111", text: "mine\n" },
      base: { from: 130, to: 140, hash: "ccc222", text: "root\n" },
      second: { from: 150, to: 160, hash: "bbb333", text: "theirs\n" },
      ...overrides,
    };
  }

  test("accept first replaces the whole hunk with the first version", () => {
    const hunk = makeHunk();
    expect(resolveHunk(hunk, "first")).toEqual({
      from: 100,
      to: 200,
      insert: "mine\n",
    });
  });

  test("accept second replaces the whole hunk with the second version", () => {
    const hunk = makeHunk();
    expect(resolveHunk(hunk, "second")).toEqual({
      from: 100,
      to: 200,
      insert: "theirs\n",
    });
  });

  test("accept both joins first then second without an extra blank line", () => {
    const hunk = makeHunk();
    expect(resolveHunk(hunk, "both")).toEqual({
      from: 100,
      to: 200,
      insert: "mine\ntheirs\n",
    });
  });

  test("restore base replaces the whole hunk with the base version", () => {
    const hunk = makeHunk();
    expect(resolveHunk(hunk, "base")).toEqual({
      from: 100,
      to: 200,
      insert: "root\n",
    });
  });

  test("accept both with an empty first section yields just the second", () => {
    const hunk = makeHunk({
      first: { from: 110, to: 110, hash: "aaa111", text: "" },
    });
    expect(resolveHunk(hunk, "both").insert).toBe("theirs\n");
  });

  test("accept both with an empty second section yields just the first", () => {
    const hunk = makeHunk({
      second: { from: 160, to: 160, hash: "bbb333", text: "" },
    });
    expect(resolveHunk(hunk, "both").insert).toBe("mine\n");
  });

  test("accept first with an empty first section yields an empty insert", () => {
    const hunk = makeHunk({
      first: { from: 110, to: 110, hash: "aaa111", text: "" },
    });
    expect(resolveHunk(hunk, "first").insert).toBe("");
  });

  test("both works for a git hunk with no base at all", () => {
    const hunk = makeHunk({
      kind: "git",
      base: undefined,
      first: { from: 110, to: 120, hash: "", label: "HEAD", text: "mine\n" },
      second: {
        from: 150,
        to: 160,
        hash: "",
        label: "feature",
        text: "theirs\n",
      },
    });
    expect(resolveHunk(hunk, "both").insert).toBe("mine\ntheirs\n");
  });

  test("restoring base on a hunk without one throws", () => {
    const hunk = makeHunk({ base: undefined });
    expect(() => resolveHunk(hunk, "base")).toThrow();
  });
});

// Regression coverage for a bug that only showed up once the decoration
// extension actually built an EditorState: `findConflictHunks` alone can't
// catch a CodeMirror-side RangeError from `hideBlockSource`, since that's
// only triggered when a real EditorState assembles the decoration set.
describe("conflictMarkers extension (smoke)", () => {
  const stubClient = {} as unknown as Client;

  function buildState(doc: string) {
    const field = conflictMarkers(stubClient);
    let state: EditorState | undefined;
    expect(() => {
      state = EditorState.create({ doc, extensions: [field] });
    }).not.toThrow();
    return state!.field(field);
  }

  test("builds for a mid-document hunk followed by more content", () => {
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
      "after\n",
    ].join("");

    expect(buildState(text).size).toBeGreaterThan(0);
  });

  test("builds for a hunk immediately followed by a blank line", () => {
    // Leading "before\n" keeps the default cursor (position 0) outside the
    // hunk range so the isCursorInRange guard doesn't itself suppress the
    // widget — the tail shape after the hunk is what's under test here.
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
      "\n",
      "after\n",
    ].join("");

    expect(buildState(text).size).toBeGreaterThan(0);
  });

  test("builds for a hunk at EOF with a trailing newline and nothing after", () => {
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333\n",
    ].join("");

    expect(buildState(text).size).toBeGreaterThan(0);
  });

  test("builds for a hunk at EOF with no trailing newline", () => {
    const text = [
      "before\n",
      "<<<<<<< SB sha256:aaa111\n",
      "mine\n",
      "||||||| SB BASE sha256:ccc222\n",
      "root\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> SB sha256:bbb333",
    ].join("");

    expect(buildState(text).size).toBeGreaterThan(0);
  });

  test("builds for a git hunk with no base", () => {
    const text = [
      "before\n",
      "<<<<<<< HEAD\n",
      "mine\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature\n",
      "after\n",
    ].join("");

    expect(buildState(text).size).toBeGreaterThan(0);
  });
});

describe("ConflictWidget.eq", () => {
  const stubClient = {} as unknown as Client;

  function makeHunk(overrides: Partial<ConflictHunk> = {}): ConflictHunk {
    return {
      from: 100,
      to: 200,
      kind: "sb",
      first: { from: 110, to: 120, hash: "aaa111", text: "mine\n" },
      base: { from: 130, to: 140, hash: "ccc222", text: "root\n" },
      second: { from: 150, to: 160, hash: "bbb333", text: "theirs\n" },
      ...overrides,
    };
  }

  test("is equal for identical hunks", () => {
    const a = new ConflictWidget(makeHunk(), stubClient);
    const b = new ConflictWidget(makeHunk(), stubClient);
    expect(a.eq(b)).toBe(true);
  });

  // A same-length external edit inside a hunk body can leave from/to and
  // every hash unchanged (hashes come from the marker lines, not the live
  // body text) — eq() must still see the body change, or CodeMirror reuses
  // stale DOM whose button closures resolve against the pre-edit text.
  test("is not equal when a section's text changed but offsets and hashes didn't", () => {
    const a = new ConflictWidget(makeHunk(), stubClient);
    const b = new ConflictWidget(
      makeHunk({
        first: { from: 110, to: 120, hash: "aaa111", text: "mine!\n" },
      }),
      stubClient,
    );
    expect(a.eq(b)).toBe(false);
  });

  test("is not equal when the base section's text changed", () => {
    const a = new ConflictWidget(makeHunk(), stubClient);
    const b = new ConflictWidget(
      makeHunk({
        base: { from: 130, to: 140, hash: "ccc222", text: "root!\n" },
      }),
      stubClient,
    );
    expect(a.eq(b)).toBe(false);
  });

  test("is not equal when the second section's text changed", () => {
    const a = new ConflictWidget(makeHunk(), stubClient);
    const b = new ConflictWidget(
      makeHunk({
        second: { from: 150, to: 160, hash: "bbb333", text: "theirs!\n" },
      }),
      stubClient,
    );
    expect(a.eq(b)).toBe(false);
  });

  test("is not equal when one hunk has a base and the other doesn't", () => {
    const withBase = new ConflictWidget(makeHunk(), stubClient);
    const withoutBase = new ConflictWidget(
      makeHunk({ kind: "git", base: undefined }),
      stubClient,
    );
    expect(withBase.eq(withoutBase)).toBe(false);
    expect(withoutBase.eq(withBase)).toBe(false);
  });

  test("is not equal when a section's git label changed", () => {
    const a = new ConflictWidget(
      makeHunk({
        kind: "git",
        first: { from: 110, to: 120, hash: "", label: "HEAD", text: "mine\n" },
      }),
      stubClient,
    );
    const b = new ConflictWidget(
      makeHunk({
        kind: "git",
        first: {
          from: 110,
          to: 120,
          hash: "",
          label: "other-branch",
          text: "mine\n",
        },
      }),
      stubClient,
    );
    expect(a.eq(b)).toBe(false);
  });
});

describe("truncateLabel", () => {
  test("leaves short text alone", () => {
    expect(truncateLabel("HEAD")).toBe("HEAD");
  });

  test("truncates to 24 chars with an ellipsis by default", () => {
    const long = "a-really-long-feature-branch-name-that-should-be-truncated";
    expect(truncateLabel(long)).toBe(`${long.slice(0, 24)}…`);
    expect(truncateLabel(long).length).toBe(25);
  });

  test("honors a custom max length", () => {
    expect(truncateLabel("abcdefgh", 4)).toBe("abcd…");
  });
});

describe("sectionTitle", () => {
  function gitHunk(overrides: Partial<ConflictHunk> = {}): ConflictHunk {
    return {
      from: 0,
      to: 10,
      kind: "git",
      first: { from: 0, to: 1, hash: "", label: "HEAD", text: "mine\n" },
      second: {
        from: 2,
        to: 3,
        hash: "",
        label: "feature",
        text: "theirs\n",
      },
      ...overrides,
    };
  }

  test("uses the git label as the title when present", () => {
    const hunk = gitHunk();
    expect(sectionTitle(hunk, "first", hunk.first)).toBe("HEAD");
    expect(sectionTitle(hunk, "second", hunk.second)).toBe("feature");
  });

  test("falls back to positional titles for a git hunk with no labels", () => {
    const hunk = gitHunk({
      first: { from: 0, to: 1, hash: "", label: "", text: "mine\n" },
      second: { from: 2, to: 3, hash: "", label: "", text: "theirs\n" },
    });
    expect(sectionTitle(hunk, "first", hunk.first)).toBe("Version 1");
    expect(sectionTitle(hunk, "second", hunk.second)).toBe("Version 2");
  });

  test("falls back to positional titles for a whitespace-only label", () => {
    const hunk = gitHunk({
      first: { from: 0, to: 1, hash: "", label: "   ", text: "mine\n" },
    });
    expect(sectionTitle(hunk, "first", hunk.first)).toBe("Version 1");
  });

  test("always uses positional titles for SB hunks, ignoring any label", () => {
    const hunk: ConflictHunk = {
      from: 0,
      to: 10,
      kind: "sb",
      first: { from: 0, to: 1, hash: "aaa111", text: "mine\n" },
      base: { from: 4, to: 5, hash: "ccc222", text: "root\n" },
      second: { from: 2, to: 3, hash: "bbb333", text: "theirs\n" },
    };
    expect(sectionTitle(hunk, "first", hunk.first)).toBe("Version 1");
    expect(sectionTitle(hunk, "base", hunk.base!)).toBe("Original");
    expect(sectionTitle(hunk, "second", hunk.second)).toBe("Version 2");
  });
});

describe("shouldRenderBasePanel", () => {
  // Pins the fact that resolveHunk("base", …) throwing on a base-less hunk
  // (see the resolveHunk tests above) is unreachable from the widget: this
  // is the exact predicate toDOM() uses to decide whether to render the
  // base panel — and thus wire up the "base" action — at all.
  test("true exactly when the hunk has a base section", () => {
    const withBase: ConflictHunk = {
      from: 0,
      to: 10,
      kind: "sb",
      first: { from: 0, to: 1, hash: "a", text: "x\n" },
      base: { from: 2, to: 3, hash: "b", text: "y\n" },
      second: { from: 4, to: 5, hash: "c", text: "z\n" },
    };
    const withoutBase: ConflictHunk = {
      from: 0,
      to: 10,
      kind: "git",
      first: { from: 0, to: 1, hash: "", label: "HEAD", text: "x\n" },
      second: { from: 2, to: 3, hash: "", label: "feature", text: "z\n" },
    };
    expect(shouldRenderBasePanel(withBase)).toBe(true);
    expect(shouldRenderBasePanel(withoutBase)).toBe(false);
  });
});

// This repo has no jsdom/happy-dom dependency, so ConflictWidget.toDOM()
// can't actually run here — the logic it renders (title text, truncation,
// base-panel gating) is pinned without a DOM by the pure-function
// describes above instead; these are left in, skipped, as the intended
// assertions for whenever a DOM environment becomes available.
describe.skip("ConflictWidget DOM — git labels as panel titles (needs jsdom, unavailable in this repo)", () => {
  const stubClient = {} as unknown as Client;

  test("uses the git label as the panel title, truncated with a tooltip", () => {
    const longLabel =
      "a-really-long-feature-branch-name-that-should-be-truncated";
    const hunk: ConflictHunk = {
      from: 0,
      to: 10,
      kind: "git",
      first: { from: 0, to: 1, hash: "", label: "HEAD", text: "mine\n" },
      second: {
        from: 2,
        to: 3,
        hash: "",
        label: longLabel,
        text: "theirs\n",
      },
    };
    const widget = new ConflictWidget(hunk, stubClient);
    const dom = widget.toDOM();

    const headers = dom.querySelectorAll(".sb-conflict-section-header");
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe("HEAD");
    expect(headers[1].textContent).toBe(`${longLabel.slice(0, 24)}…`);

    const panels = dom.querySelectorAll(".sb-conflict-section");
    expect(panels[1].getAttribute("title")).toContain(longLabel);
    expect(panels[1].getAttribute("aria-label")).toBe(`Accept ${longLabel}`);
  });

  test("falls back to positional titles when a git hunk has no labels", () => {
    const hunk: ConflictHunk = {
      from: 0,
      to: 10,
      kind: "git",
      first: { from: 0, to: 1, hash: "", label: "", text: "mine\n" },
      second: { from: 2, to: 3, hash: "", label: "", text: "theirs\n" },
    };
    const widget = new ConflictWidget(hunk, stubClient);
    const dom = widget.toDOM();

    const headers = dom.querySelectorAll(".sb-conflict-section-header");
    expect(headers[0].textContent).toBe("Version 1");
    expect(headers[1].textContent).toBe("Version 2");
  });

  test("only renders a base panel when the hunk has one", () => {
    const withoutBase: ConflictHunk = {
      from: 0,
      to: 10,
      kind: "git",
      first: { from: 0, to: 1, hash: "", label: "HEAD", text: "mine\n" },
      second: { from: 2, to: 3, hash: "", label: "feature", text: "theirs\n" },
    };
    const dom = new ConflictWidget(withoutBase, stubClient).toDOM();
    expect(dom.querySelectorAll(".sb-conflict-section")).toHaveLength(2);
  });
});
