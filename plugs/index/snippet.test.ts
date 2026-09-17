import { expect, test } from "vitest";
import { extractSnippet } from "./snippet.ts";

test("extractSnippetByIndentation", () => {
  const text = `* Item 1
  * Item 1.1
    * Item 1.1.1
      * Item 1.1.1.1
    * Item 1.1.2
  * Item 1.2
* Item 2
  * Item 2.1`;

  // Unindented line with children
  expect(extractSnippet("test", text, text.indexOf("* Item 1"))).toEqual(
    "* Item 1\n  * Item 1.1\n    * Item 1.1.1\n      * Item 1.1.1.1\n    * Item 1.1.2\n  * Item 1.2",
  );

  // Indented line with children (left-aligned)
  expect(extractSnippet("test", text, text.indexOf("Item 1.1"))).toEqual(
    "* Item 1.1\n  * Item 1.1.1\n    * Item 1.1.1.1\n  * Item 1.1.2",
  );

  // Deeply nested line (left-aligned)
  expect(extractSnippet("test", text, text.indexOf("Item 1.1.1.1"))).toEqual(
    "* Item 1.1.1.1",
  );

  // Stops at sibling
  expect(extractSnippet("test", text, text.indexOf("Item 1.2"))).toEqual(
    "* Item 1.2",
  );

  // Stops at empty line
  const text2 = `* Item A
  * Item A.1
    Content

  * Item A.2`;
  expect(extractSnippet("test", text2, text2.indexOf("Item A.1"))).toEqual(
    "* Item A.1\n  Content",
  );

  // Header extracts only itself and strips # marker
  const text3 = `## Sub Header
More text`;
  expect(extractSnippet("test", text3, text3.indexOf("## Sub Header"))).toEqual(
    "Sub Header",
  );

  // maxLines limits the number of lines
  const text4 = `* Item X
  * Item X.1
  * Item X.2
  * Item X.3
  * Item X.4`;
  expect(extractSnippet("test", text4, text4.indexOf("* Item X"), 3)).toEqual(
    "* Item X\n  * Item X.1\n  * Item X.2\n...",
  );

  // maxLines limits the number of lines
  const text5 = `  * Item X
    * [ ] Hello`;
  const taskPos = text5.indexOf("* [ ]");
  expect(extractSnippet("test", text5, text4.indexOf("* Item X"))).toEqual(
    `* Item X\n  * [ ] [[test@${taskPos}]] Hello`,
  );
});

test("extractSnippet neutralizes transclusions into plain links", () => {
  // A snippet is a preview; a live `![[page]]` inside it would make every
  // consumer that expands transclusions inline the whole target page.
  const text = `# API
![[API]]
# Next section`;
  expect(extractSnippet("test", text, text.indexOf("![[API]]"))).toEqual(
    "[[API]]",
  );
});

test("extractSnippet references a task whose body is shorter than two characters", () => {
  // A one- or two-character body is still a task, and without the injected
  // `Page@pos` reference it cannot be toggled from a Linked Mentions widget.
  const text1 = `* Parent [[Target]]
  * [ ] Hi`;
  const pos1 = text1.indexOf("* [ ]");
  expect(extractSnippet("test", text1, text1.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos1}]] Hi`,
  );

  const text2 = `* Parent [[Target]]
  * [ ] H`;
  const pos2 = text2.indexOf("* [ ]");
  expect(extractSnippet("test", text2, text2.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos2}]] H`,
  );
});

test("extractSnippet references a task whose body opens with a bracket", () => {
  // Only a leading `[[` means "already referenced"; a markdown link or an
  // attribute opens with a single `[` and must still get a reference.
  const text1 = `* Parent [[Target]]
  * [ ] [Google](https://google.com) look it up`;
  const pos1 = text1.indexOf("* [ ]");
  expect(extractSnippet("test", text1, text1.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos1}]] [Google](https://google.com) look it up`,
  );

  const text2 = `* Parent [[Target]]
  * [ ] [due: 2026-01-01] pay rent`;
  const pos2 = text2.indexOf("* [ ]");
  expect(extractSnippet("test", text2, text2.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos2}]] [due: 2026-01-01] pay rent`,
  );
});

test("extractSnippet references a task whose body has a bracket past the first character", () => {
  // The old two-character guard also rejected bodies whose *second* character
  // was a `[`, and short bodies that are nothing but brackets.
  const text1 = `* Parent [[Target]]
  * [ ] a[b: c] thing`;
  const pos1 = text1.indexOf("* [ ]");
  expect(extractSnippet("test", text1, text1.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos1}]] a[b: c] thing`,
  );

  const text2 = `* Parent [[Target]]
  * [ ] [x`;
  const pos2 = text2.indexOf("* [ ]");
  expect(extractSnippet("test", text2, text2.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos2}]] [x`,
  );

  const text3 = `* Parent [[Target]]
  * [ ] [`;
  const pos3 = text3.indexOf("* [ ]");
  expect(extractSnippet("test", text3, text3.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos3}]] [`,
  );
});

test("extractSnippet references a task whose body starts with a transclusion", () => {
  // `![[Other]]` is neutralized into `[[Other]]` further down, which makes the
  // line *look* referenced while carrying no `@pos` to write a toggle back to.
  // The reference is what this asserts on, not that the line changed.
  const text1 = `* Parent [[Target]]
  * [ ] ![[Other]] see`;
  const pos1 = text1.indexOf("* [ ]");
  expect(extractSnippet("test", text1, text1.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos1}]] [[Other]] see`,
  );

  const text2 = `* Parent [[Target]]
  * [ ] ![[Other]]`;
  const pos2 = text2.indexOf("* [ ]");
  expect(extractSnippet("test", text2, text2.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos2}]] [[Other]]`,
  );
});

test("extractSnippet references short task bodies for every marker and state", () => {
  // The marker and state groups are untouched by the body guard, so a short
  // body has to be referenced whatever marker or state it carries.
  const dash = `* Parent [[Target]]
  - [ ] Hi`;
  expect(extractSnippet("test", dash, dash.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  - [ ] [[test@${dash.indexOf("- [ ]")}]] Hi`,
  );

  const done = `* Parent [[Target]]
  * [x] Hi`;
  expect(extractSnippet("test", done, done.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [x] [[test@${done.indexOf("* [x]")}]] Hi`,
  );

  const custom = `* Parent [[Target]]
  * [TODO] Hi`;
  expect(extractSnippet("test", custom, custom.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [TODO] [[test@${custom.indexOf("* [TODO]")}]] Hi`,
  );
});

test("extractSnippet references a deeper indented task at its own offset", () => {
  // The offset is `lineOffsets[i] + indent`: a wrong one silently toggles
  // another task, so the extra indent has to show up in the reference.
  const text = `* Parent [[Target]]
    * [ ] Hi`;
  const pos = text.indexOf("* [ ]");
  expect(pos).toEqual(24);
  expect(extractSnippet("test", text, text.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n    * [ ] [[test@${pos}]] Hi`,
  );
});

test("extractSnippet keeps every task offset when it references several", () => {
  // Offsets come from the original text, so referencing one line must not
  // shift the reference of any line below it.
  const text = `* Parent [[Target]]
  * [ ] Hi
  * [ ] Longer body here
  * [ ] H`;
  const first = text.indexOf("* [ ] Hi");
  const second = text.indexOf("* [ ] Longer");
  const third = text.lastIndexOf("* [ ] H");
  expect([first, second, third]).toEqual([22, 33, 58]);
  expect(extractSnippet("test", text, text.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${first}]] Hi\n  * [ ] [[test@${second}]] Longer body here\n  * [ ] [[test@${third}]] H`,
  );
});

test("extractSnippet references a task whose body is only whitespace", () => {
  // A body of pure whitespace was already referenced when it was long enough
  // for the old guard (four spaces or more); the body guard only decides how
  // much of it is needed, so the short form has to behave the same way.
  const text = `* Parent [[Target]]
  * [ ]${"  "}`;
  const pos = text.indexOf("* [ ]");
  expect(extractSnippet("test", text, text.indexOf("* Parent"))).toEqual(
    `* Parent [[Target]]\n  * [ ] [[test@${pos}]] ${" "}`,
  );
});

test("extractSnippet leaves an already-referenced task alone", () => {
  // (control) A body that opens with `[[` is already a reference; adding a
  // second one would point the widget's toggle at the wrong offset.
  const text = `* Parent [[Target]]
  * [ ] [[test@40]] Already referenced`;
  expect(extractSnippet("test", text, text.indexOf("* Parent"))).toEqual(
    "* Parent [[Target]]\n  * [ ] [[test@40]] Already referenced",
  );
});

test("extractSnippet skips any body opening with two brackets", () => {
  // (control) The guard is a prefix test, not a well-formed-link test: an
  // unterminated `[[` and a `[[[` are skipped as well, on both the old and the
  // new form. This is what pins that swapping the character class for a
  // lookahead did not widen the set of bodies treated as unreferenced.
  const text1 = `* Parent [[Target]]
  * [ ] [[`;
  expect(extractSnippet("test", text1, text1.indexOf("* Parent"))).toEqual(
    "* Parent [[Target]]\n  * [ ] [[",
  );

  const text2 = `* Parent [[Target]]
  * [ ] [[[X]]`;
  expect(extractSnippet("test", text2, text2.indexOf("* Parent"))).toEqual(
    "* Parent [[Target]]\n  * [ ] [[[X]]",
  );
});

test("extractSnippet leaves a task with a trailing carriage return alone", () => {
  // (control) `.` never matches `\r`, so a CRLF file's task lines are not
  // referenced — before or after this change. Pins that the new guard did not
  // start matching them either.
  const text = `* Parent [[Target]]\n  * [ ] H\r`;
  expect(extractSnippet("test", text, text.indexOf("* Parent"))).toEqual(
    "* Parent [[Target]]\n  * [ ] H\r",
  );
});
