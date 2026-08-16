import { expect, test } from "vitest";
import {
  buildCommentScaffold,
  computeCommentInsertion,
  parseCommentBlock,
  sanitizeQuote,
} from "./comments.ts";

test("minimal hand-typed comment", () => {
  const p = parseCommentBlock(`<!-- @pete: check this -->`);
  expect(p).not.toBeNull();
  expect(p!.thread).toEqual([{ addressee: "pete", text: "check this" }]);
  expect(p!.waitingOn).toBe("pete");
  expect(p!.addressees).toEqual(["pete"]);
  expect(p!.quote).toBeUndefined();
});

test("anchor line, signature, and thread", () => {
  const raw = `<!-- re: "matching Obsidian's anchor"
     @pete: is this still current? — john, 2026-08-04
     @john: checked, still $50 — pete, 2026-08-05 -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.quote).toBe("matching Obsidian's anchor");
  expect(p.thread.length).toBe(2);
  expect(p.thread[0]).toEqual({
    addressee: "pete",
    text: "is this still current?",
    author: "john",
    date: "2026-08-04",
  });
  expect(p.waitingOn).toBe("john");
  expect(p.lastDate).toBe("2026-08-05");
  expect(p.addressees).toEqual(["pete", "john"]);
});

test("curly-quote anchor delimiters accepted", () => {
  const raw = `<!-- re: “some “nested” phrase”\n@pete: hm -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.quote).toBe("some “nested” phrase");
});

test("continuation lines attach to previous message", () => {
  const p = parseCommentBlock(
    `<!-- @pete: first line\nsecond line of same message -->`,
  )!;
  expect(p.thread[0].text).toBe("first line second line of same message");
});

// A signature closes a message: a bare line after a signed message starts a
// NEW unaddressed message instead of continuing the signed one. Without
// this, an unaddressed reply appended after a signed message is
// indistinguishable from a continuation of it (the bug a real Reply-button
// round-trip hit: see client/codemirror/comment_widget.ts buildReplyInsertion).
test("a signature closes a message: a following bare line starts a new message", () => {
  const raw = `<!-- re: "the surrounding text"
     Commenting on a specific phrase — 2026-08-05
     Hello -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.quote).toBe("the surrounding text");
  expect(p.thread).toEqual([
    { text: "Commenting on a specific phrase", date: "2026-08-05" },
    { text: "Hello" },
  ]);
});

test("a signature mid-continuation closes the message, and a later bare line starts a new one", () => {
  const raw = `<!-- @john: line1\nline2 — pete, 2026-08-05\nfollow-up -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.thread).toEqual([
    {
      addressee: "john",
      text: "line1 line2",
      author: "pete",
      date: "2026-08-05",
    },
    { text: "follow-up" },
  ]);
});

test("an unsigned multi-line bare note still joins into a single message", () => {
  const raw = `<!-- first line\nsecond line\nthird line -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.thread).toEqual([{ text: "first line second line third line" }]);
});

test("a signed line followed directly by another signed line stays two messages", () => {
  const raw = `<!-- @pete: first — john, 2026-08-04\n@john: second — pete, 2026-08-05 -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.thread).toEqual([
    { addressee: "pete", text: "first", author: "john", date: "2026-08-04" },
    { addressee: "john", text: "second", author: "pete", date: "2026-08-05" },
  ]);
});

test("double-hyphen inside message tolerated", () => {
  const p = parseCommentBlock(`<!-- @pete: check the -- flag -->`)!;
  expect(p.thread[0].text).toBe("check the -- flag");
});

test("double-dash signature separator is accepted, with author", () => {
  const p = parseCommentBlock(`<!-- get milk -- john, 2026-08-05 -->`)!;
  expect(p.thread).toEqual([
    {
      text: "get milk",
      author: "john",
      date: "2026-08-05",
    },
  ]);
});

test("single-dash signature separator is accepted, date-only", () => {
  const p = parseCommentBlock(`<!-- note - 2026-08-05 -->`)!;
  expect(p.thread).toEqual([{ text: "note", date: "2026-08-05" }]);
});

test("en-dash signature separator is accepted", () => {
  const p = parseCommentBlock(`<!-- note – john, 2026-08-05 -->`)!;
  expect(p.thread).toEqual([
    {
      text: "note",
      author: "john",
      date: "2026-08-05",
    },
  ]);
});

// The signature separator is the LAST valid dash-like split on the line,
// not the first. `String.match` alone always returns the leftmost match, so
// `extractSig` anchors the whole pattern and uses a greedy text prefix to
// force the rightmost split -- these two cases would otherwise mis-split on
// an earlier, incidental hyphen in the message text.
test("incidental hyphen earlier in the text doesn't steal the signature split", () => {
  const p = parseCommentBlock(
    `<!-- draft - then revise - john, 2026-08-05 -->`,
  )!;
  expect(p.thread).toEqual([
    {
      text: "draft - then revise",
      author: "john",
      date: "2026-08-05",
    },
  ]);
});

test("leading hyphen (e.g. a list item) doesn't steal the signature split", () => {
  const p = parseCommentBlock(`<!-- - a list item - john, 2026-08-05 -->`)!;
  expect(p.thread).toEqual([
    {
      text: "- a list item",
      author: "john",
      date: "2026-08-05",
    },
  ]);
});

test("a comma inside the message text doesn't get mistaken for the author's trailing comma", () => {
  const p = parseCommentBlock(`<!-- meet ana, maria — 2026-08-05 -->`)!;
  expect(p.thread).toEqual([{ text: "meet ana, maria", date: "2026-08-05" }]);
  expect(p.thread[0].author).toBeUndefined();
});

test("a bare date in prose with no separator character isn't mistaken for a signature", () => {
  const p = parseCommentBlock(
    `<!-- the value was set on 2026-08-05 in prose -->`,
  )!;
  expect(p.thread).toEqual([
    {
      text: "the value was set on 2026-08-05 in prose",
    },
  ]);
});

test("non-conforming comments return null", () => {
  // "just a note to self" is no longer non-conforming -- every HTML comment
  // that isn't a machine directive is now a note (see the "fully bare
  // comment" test below).
  expect(parseCommentBlock(`<!--#lua query[[from p = ...]] -->`)).toBeNull();
  expect(parseCommentBlock(`<!--/lua-->`)).toBeNull();
  expect(parseCommentBlock(`<!-- re: "quote but no message" -->`)).toBeNull();
});

test("sanitizeQuote truncates, collapses, substitutes", () => {
  expect(sanitizeQuote(`a "b"\n  c -- d`)).toBe(`a 'b' c – d`);
  expect(sanitizeQuote("x".repeat(100)).length).toBe(80);
});

// Spec change: the scaffold no longer has an "@" addressee slot at all --
// addressing is now optional, so the scaffold just carries a signature
// (the block's marker) and the cursor lands at the message position, right
// before that signature.
//
// Formatting: generated comments are left-aligned (no indentation), and a
// block that spans multiple lines gets its closing `-->` on its own line.
// A quoted scaffold is multi-line (the `re:` line plus the message line),
// so the closer moves to a third line.
test("scaffold has cursor at the message position, before the signature", () => {
  const { text, cursorOffset } = buildCommentScaffold({
    quote: "some phrase",
    author: "john",
    date: "2026-08-04",
  });
  expect(text).toBe(`<!-- re: "some phrase"\n — john, 2026-08-04\n-->`);
  expect(text.slice(cursorOffset)).toBe(" — john, 2026-08-04\n-->");
});

test("scaffold without quote or author falls back to a date-only signature", () => {
  const { text, cursorOffset } = buildCommentScaffold({
    date: "2026-08-04",
  });
  // No quote means a single line, so the closer stays inline.
  expect(text).toBe(`<!--  — 2026-08-04 -->`);
  expect(text.slice(cursorOffset)).toBe(" — 2026-08-04 -->");
  // The date-only signature is still a marker, so this parses as conforming.
  expect(parseCommentBlock(text)).not.toBeNull();
});

test("insertion lands after the selection's block", () => {
  const doc = `First para line one.\nStill first para.\n\nSecond para.\n`;
  const selFrom = doc.indexOf("Still");
  const selTo = selFrom + 5;
  const r = computeCommentInsertion(doc, selFrom, selTo, {
    author: "john",
    date: "2026-08-04",
  });
  // insertAt = end of "Still first para." line (before the blank line)
  expect(doc.slice(0, r.insertAt).endsWith("Still first para.")).toBe(true);
  expect(r.text.startsWith(`\n<!-- re: "Still"`)).toBe(true);
  expect(r.text.slice(r.cursorPos - r.insertAt)).toBe(
    " — john, 2026-08-04\n-->",
  );
});

test("insertion at end of document without trailing newline", () => {
  const doc = `Only line`;
  const r = computeCommentInsertion(doc, 0, 4, { date: "2026-08-04" });
  expect(r.insertAt).toBe(doc.length);
});

test("unaddressed note with author signature parses as a note-to-self", () => {
  const p = parseCommentBlock(
    `<!-- rephrase this later — john, 2026-08-05 -->`,
  )!;
  expect(p).not.toBeNull();
  expect(p.thread).toEqual([
    {
      text: "rephrase this later",
      author: "john",
      date: "2026-08-05",
    },
  ]);
  expect(p.thread[0].addressee).toBeUndefined();
  expect(p.waitingOn).toBeUndefined();
  expect(p.addressees).toEqual([]);
  expect(p.lastDate).toBe("2026-08-05");
});

test("unaddressed note with a date-only signature parses", () => {
  const p = parseCommentBlock(`<!-- rephrase this later — 2026-08-05 -->`)!;
  expect(p).not.toBeNull();
  expect(p.thread).toEqual([
    { text: "rephrase this later", date: "2026-08-05" },
  ]);
  expect(p.thread[0].author).toBeUndefined();
  expect(p.waitingOn).toBeUndefined();
});

// REVERSES the previous "stray line before the first message degrades to
// null" expectation: bare text before the first @name: line is no longer
// treated as a corrupt/non-conforming block -- it's now a legitimate
// unaddressed message that precedes an addressed one, and the leading
// `re:` anchor is itself already a sufficient marker for conformance.
test("re: anchor plus bare text before the first @name: line is conforming", () => {
  const raw = `<!-- re: "foo"\njunk\n@pete: hi -->`;
  const p = parseCommentBlock(raw)!;
  expect(p).not.toBeNull();
  expect(p.quote).toBe("foo");
  expect(p.thread).toEqual([
    { text: "junk" },
    { addressee: "pete", text: "hi" },
  ]);
  expect(p.waitingOn).toBe("pete");
  expect(p.addressees).toEqual(["pete"]);
});

test("fully bare comment with no marker at all parses as one unaddressed, unsigned note", () => {
  const p = parseCommentBlock(`<!-- remember this -->`)!;
  expect(p).not.toBeNull();
  expect(p.thread).toEqual([{ text: "remember this" }]);
  expect(p.thread[0].addressee).toBeUndefined();
  expect(p.thread[0].author).toBeUndefined();
  expect(p.thread[0].date).toBeUndefined();
  expect(p.waitingOn).toBeUndefined();
  expect(p.addressees).toEqual([]);
  expect(p.quote).toBeUndefined();
  expect(p.lastDate).toBeUndefined();
});

test("empty and whitespace-only comments stay null", () => {
  expect(parseCommentBlock(`<!-- -->`)).toBeNull();
  expect(parseCommentBlock(`<!--   -->`)).toBeNull();
});

test("multi-line bare comment joins its lines into one message", () => {
  const p = parseCommentBlock(`<!-- first line\nsecond line -->`)!;
  expect(p).not.toBeNull();
  expect(p.thread).toEqual([{ text: "first line second line" }]);
});

test("baked lua section is not treated as a comment", () => {
  expect(parseCommentBlock(`<!--#lua 3 + 4 -->`)).toBeNull();
  expect(parseCommentBlock(`<!--/lua-->`)).toBeNull();
});

// Formatting change: generated comments are now left-aligned (no
// indentation), with the closing `-->` on its own line whenever the block
// spans multiple lines. The parser itself needs no grammar change for
// this -- lines are trimmed regardless of indentation, and a bare `-->`
// terminator line never reaches the per-line loop (it's consumed by the
// outer `<!--...-->` match before splitting into lines). These two tests
// pin that down: the new left-aligned/own-line-closer shape, and that a
// legacy indented/inline-closer block on disk still parses identically.
test("parses the new left-aligned, closer-on-its-own-line format", () => {
  const raw = `<!-- re: "making a claim"
@pete: verify this — john, 2026-08-04
@john: confirmed — pete, 2026-08-06
-->`;
  const p = parseCommentBlock(raw)!;
  expect(p.quote).toBe("making a claim");
  expect(p.thread).toEqual([
    {
      addressee: "pete",
      text: "verify this",
      author: "john",
      date: "2026-08-04",
    },
    {
      addressee: "john",
      text: "confirmed",
      author: "pete",
      date: "2026-08-06",
    },
  ]);
  expect(p.waitingOn).toBe("john");
  expect(p.addressees).toEqual(["pete", "john"]);
  expect(p.lastDate).toBe("2026-08-06");
});

test("a legacy indented block with an inline closer still parses identically", () => {
  const raw = `<!-- re: "making a claim"
     @pete: verify this — john, 2026-08-04
     @john: confirmed — pete, 2026-08-06 -->`;
  const p = parseCommentBlock(raw)!;
  expect(p.quote).toBe("making a claim");
  expect(p.thread).toEqual([
    {
      addressee: "pete",
      text: "verify this",
      author: "john",
      date: "2026-08-04",
    },
    {
      addressee: "john",
      text: "confirmed",
      author: "pete",
      date: "2026-08-06",
    },
  ]);
  expect(p.waitingOn).toBe("john");
  expect(p.addressees).toEqual(["pete", "john"]);
  expect(p.lastDate).toBe("2026-08-06");
});
