// Regression coverage for the rename-refactor splice. Covers every
// textual reference form the rename refactor must rewrite when
// `oldName` is renamed to `newName`. Range-driven; no link-index
// dependency.

import { describe, expect, test } from "vitest";
import { spliceReference } from "./refactor_splice.ts";

function splice(
  text: string,
  marker: string,
  oldName: string,
  newName: string,
  pageToEdit = "Editor",
): string {
  // Helper: locate `marker` in `text` and use its [start, end] as the
  // splice range. Lets the tests read like "rename the thing here".
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`marker not found in fixture: ${marker}`);
  const end = start + marker.length;
  return spliceReference({
    text,
    range: [start, end],
    oldName,
    newName,
    pageToEdit,
  });
}

describe("wikilinks", () => {
  test("bare wikilink", () => {
    expect(
      splice("Before [[Old]] after.", "[[Old]]", "Old", "New"),
    ).toBe("Before [[New]] after.");
  });

  test("wikilink with alias", () => {
    expect(
      splice("Before [[Old|the alias]] after.", "[[Old|the alias]]", "Old", "New"),
    ).toBe("Before [[New|the alias]] after.");
  });

  test("wikilink with header detail", () => {
    expect(
      splice("See [[Old#Heading]].", "[[Old#Heading]]", "Old", "New"),
    ).toBe("See [[New#Heading]].");
  });

  test("wikilink with position detail", () => {
    expect(
      splice("See [[Old@142]].", "[[Old@142]]", "Old", "New"),
    ).toBe("See [[New@142]].");
  });

  test("wikilink with anchor detail", () => {
    expect(
      splice("See [[Old$myAnchor]].", "[[Old$myAnchor]]", "Old", "New"),
    ).toBe("See [[New$myAnchor]].");
  });

  test("wikilink with header detail and alias", () => {
    expect(
      splice("See [[Old#H|label]].", "[[Old#H|label]]", "Old", "New"),
    ).toBe("See [[New#H|label]].");
  });

  test("wikilink at start of line", () => {
    expect(
      splice("[[Old]] starts the line.", "[[Old]]", "Old", "New"),
    ).toBe("[[New]] starts the line.");
  });

  test("wikilink at end of file", () => {
    expect(
      splice("Trailing [[Old]]", "[[Old]]", "Old", "New"),
    ).toBe("Trailing [[New]]");
  });

  test("wikilink with `.md` suffix is normalized", () => {
    // Conventionally wikilinks omit `.md`; the legacy refactor produced
    // a bare name and we preserve that behavior.
    expect(
      splice("See [[Old.md]].", "[[Old.md]]", "Old", "New"),
    ).toBe("See [[New]].");
  });

  test("wikilink whose target doesn't match oldName is left alone", () => {
    // Defensive — index says this links to Old, but the source text
    // doesn't agree. Don't rewrite.
    expect(
      splice("See [[Different]].", "[[Different]]", "Old", "New"),
    ).toBe("See [[Different]].");
  });
});

describe("markdown links (relative)", () => {
  test("bare markdown link", () => {
    expect(
      splice("See [text](Old).", "[text](Old)", "Old", "New", "Editor"),
    ).toBe("See [text](New).");
  });

  test("markdown link with header detail", () => {
    expect(
      splice("See [text](Old#sec).", "[text](Old#sec)", "Old", "New", "Editor"),
    ).toBe("See [text](New#sec).");
  });

  test("markdown link with position detail", () => {
    expect(
      splice("See [text](Old@142).", "[text](Old@142)", "Old", "New", "Editor"),
    ).toBe("See [text](New@142).");
  });

  test("markdown link in subfolder editor (relative-path math)", () => {
    // From the editor's perspective at "sub/Editor", a link to a
    // top-level "New" resolves relatively.
    expect(
      splice("Link [t](Old).", "[t](Old)", "Old", "New", "sub/Editor"),
    ).toBe("Link [t](../New).");
  });

  test("markdown link preserves [text] empty", () => {
    expect(
      splice("[](Old)", "[](Old)", "Old", "New", "Editor"),
    ).toBe("[](New)");
  });
});

describe("markdown links (absolute)", () => {
  test("absolute path leading slash preserved", () => {
    expect(
      splice("See [t](/Old).", "[t](/Old)", "Old", "New", "Editor"),
    ).toBe("See [t](/New).");
  });

  test("absolute path with detail", () => {
    expect(
      splice("See [t](/Old#sec).", "[t](/Old#sec)", "Old", "New", "Editor"),
    ).toBe("See [t](/New#sec).");
  });
});

describe("markdown links (angle-wrapped)", () => {
  test("preserves angle wrapping when present", () => {
    expect(
      splice("[t](<Old>)", "[t](<Old>)", "Old", "New", "Editor"),
    ).toBe("[t](<New>)");
  });

  test("auto-wraps when the new name contains spaces", () => {
    expect(
      splice("[t](Old).", "[t](Old)", "Old", "New Name", "Editor"),
    ).toBe("[t](<New Name>).");
  });

  test("auto-wraps absolute path with spaces", () => {
    expect(
      splice("[t](/Old).", "[t](/Old)", "Old", "New Name", "Editor"),
    ).toBe("[t](</New Name>).");
  });
});

describe("multiple references on one line", () => {
  test("each splice is independent (caller iterates back-to-front)", () => {
    let text = "Two [[Old]] references [[Old]] here.";
    // Splice the second one first (back-to-front).
    const second = text.lastIndexOf("[[Old]]");
    text = spliceReference({
      text,
      range: [second, second + "[[Old]]".length],
      oldName: "Old",
      newName: "New",
      pageToEdit: "Editor",
    });
    expect(text).toBe("Two [[Old]] references [[New]] here.");
    const first = text.indexOf("[[Old]]");
    text = spliceReference({
      text,
      range: [first, first + "[[Old]]".length],
      oldName: "Old",
      newName: "New",
      pageToEdit: "Editor",
    });
    expect(text).toBe("Two [[New]] references [[New]] here.");
  });
});

describe("non-link slice returns text unchanged", () => {
  test("empty range", () => {
    expect(
      spliceReference({
        text: "Some text",
        range: [3, 3],
        oldName: "x",
        newName: "y",
        pageToEdit: "Editor",
      }),
    ).toBe("Some text");
  });

  test("range doesn't start with `[`", () => {
    expect(
      spliceReference({
        text: "Some text",
        range: [0, 4],
        oldName: "x",
        newName: "y",
        pageToEdit: "Editor",
      }),
    ).toBe("Some text");
  });
});
