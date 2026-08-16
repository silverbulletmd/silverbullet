import { expect, test } from "vitest";
import { parseCommentBlock } from "../../plug-api/lib/comments.ts";
import { buildReplyInsertion, resolveRange } from "./comment_widget.ts";

const raw = `<!-- @pete: is this right? — john, 2026-08-04 -->`;

test("reply inserts a pre-addressed line before the closing marker", () => {
  const parsed = parseCommentBlock(raw)!;
  const r = buildReplyInsertion(raw, 100, parsed, "pete", "2026-08-05");
  // Reply is addressed to the last message's author (john), left-aligned
  // (no indentation).
  expect(r.text).toBe(`\n@john:  — pete, 2026-08-05\n`);
  // Inserted right before the literal `-->`, offset by blockFrom. The block
  // was single-line with an inline closer, so a reply always makes it
  // multi-line -- the trailing `\n` in r.text pushes `-->` onto its own line.
  expect(r.insertAt).toBe(100 + raw.lastIndexOf("-->"));
  expect(r.cursorPos).toBe(r.insertAt + r.text.indexOf(": ") + 2);
});

test("reply to unsigned message falls back to prior addressee", () => {
  const noSig = `<!-- @pete: ping\n@john: pong -->`;
  const parsed = parseCommentBlock(noSig)!;
  const r = buildReplyInsertion(noSig, 0, parsed, undefined, "2026-08-05");
  // Last message (@john: pong) is unsigned → address the reply to its addressee's
  // counterpart: the previous message's addressee (pete). No author is
  // configured, but the reply still carries a date-only signature -- an
  // unsigned reply would otherwise read as a continuation of the message
  // before it (see the "a signature closes a message" rule in
  // plug-api/lib/comments.ts).
  expect(r.text).toBe(`\n@pete:  — 2026-08-05\n`);
});

test("reply to a fully unaddressed note inserts an unaddressed reply line", () => {
  // No addressee anywhere in the thread and the last message is unsigned,
  // so there's nobody to address the reply to or reply back to.
  const noteToSelf = `<!-- rephrase this later — 2026-08-05 -->`;
  const parsed = parseCommentBlock(noteToSelf)!;
  const r = buildReplyInsertion(noteToSelf, 0, parsed, "pete", "2026-08-06");
  expect(r.text).toBe(`\n — pete, 2026-08-06\n`);
  expect(r.text.startsWith("\n")).toBe(true);
  expect(r.cursorPos).toBe(r.insertAt + "\n".length);
});

test("unaddressed reply with no configured author still carries a date-only signature", () => {
  // Regression test: an unsigned unaddressed reply used to be inserted
  // bare, making it indistinguishable from a continuation of the message
  // before it once parsed back.
  const noteToSelf = `<!-- rephrase this later — 2026-08-05 -->`;
  const parsed = parseCommentBlock(noteToSelf)!;
  const r = buildReplyInsertion(noteToSelf, 0, parsed, undefined, "2026-08-06");
  expect(r.text).toBe(`\n — 2026-08-06\n`);
  // Splice exactly where a real insertion would land. The inserted line,
  // appended after the original message, parses as a second, separate
  // message rather than folding into the first -- and the closer ends up
  // on its own line since the block is now multi-line.
  const rebuilt =
    noteToSelf.slice(0, r.insertAt) + r.text + noteToSelf.slice(r.insertAt);
  const reparsed = parseCommentBlock(rebuilt)!;
  expect(reparsed.thread.length).toBe(2);
  expect(reparsed.thread[1]).toEqual({ text: "", date: "2026-08-06" });
});

test("replying to a block whose closer is already on its own line doesn't double the newline", () => {
  const raw = `<!-- @pete: verify this — john, 2026-08-04
@john: on it — pete, 2026-08-05
-->`;
  const parsed = parseCommentBlock(raw)!;
  const r = buildReplyInsertion(raw, 0, parsed, "john", "2026-08-06");
  // No leading "\n" this time -- the closer was already on its own line, so
  // inserting right before it (which already starts a fresh line) is enough.
  expect(r.text).toBe(`@pete:  — john, 2026-08-06\n`);
  expect(r.insertAt).toBe(raw.lastIndexOf("-->"));
  expect(r.cursorPos).toBe(r.insertAt + r.text.indexOf(": ") + 2);

  const rebuilt = raw.slice(0, r.insertAt) + r.text + raw.slice(r.insertAt);
  // No blank line snuck in between the two prior messages and the new one.
  expect(rebuilt).not.toContain("\n\n");
  const reparsed = parseCommentBlock(rebuilt)!;
  expect(reparsed.thread.length).toBe(3);
  expect(reparsed.thread[2]).toEqual({
    addressee: "pete",
    text: "",
    author: "john",
    date: "2026-08-06",
  });
});

test("resolveRange swallows the leading newline", () => {
  const doc = `Para.\n<!-- @a: x -->\nAfter.`;
  const from = doc.indexOf("<!--");
  const to = doc.indexOf("-->") + 3;
  expect(resolveRange(doc, [from, to])).toEqual([from - 1, to]);
});

test("reply insertion falls back to bare closer when comment lacks a space before -->", () => {
  const raw = `<!-- @pete: hi-->`;
  const parsed = parseCommentBlock(raw)!;
  const r = buildReplyInsertion(raw, 50, parsed, "pete", "2026-08-05");
  expect(r.insertAt).toBe(50 + raw.lastIndexOf("-->"));
  expect(r.text.startsWith("\n")).toBe(true);
});

test("resolveRange at document start", () => {
  const doc = `<!-- @a: x -->\nAfter.`;
  expect(resolveRange(doc, [0, doc.indexOf("-->") + 3])).toEqual([
    0,
    doc.indexOf("-->") + 3,
  ]);
});
