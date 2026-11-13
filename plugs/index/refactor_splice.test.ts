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
    expect(splice("Before [[Old]] after.", "[[Old]]", "Old", "New")).toBe(
      "Before [[New]] after.",
    );
  });

  test("wikilink with alias", () => {
    expect(
      splice(
        "Before [[Old|the alias]] after.",
        "[[Old|the alias]]",
        "Old",
        "New",
      ),
    ).toBe("Before [[New|the alias]] after.");
  });

  test("wikilink with header detail", () => {
    expect(
      splice("See [[Old#Heading]].", "[[Old#Heading]]", "Old", "New"),
    ).toBe("See [[New#Heading]].");
  });

  test("wikilink with position detail", () => {
    expect(splice("See [[Old@142]].", "[[Old@142]]", "Old", "New")).toBe(
      "See [[New@142]].",
    );
  });

  test("wikilink with anchor detail", () => {
    expect(
      splice("See [[Old$myAnchor]].", "[[Old$myAnchor]]", "Old", "New"),
    ).toBe("See [[New$myAnchor]].");
  });

  test("wikilink with `.md` suffix is normalized", () => {
    // Wikilinks omit the .md extension.
    expect(splice("See [[Old.md]].", "[[Old.md]]", "Old", "New")).toBe(
      "See [[New]].",
    );
  });

  test("wikilink whose target doesn't match oldName is left alone", () => {
    // Defensive — index says this links to Old, but the source text
    // doesn't agree. Don't rewrite.
    expect(splice("See [[Different]].", "[[Different]]", "Old", "New")).toBe(
      "See [[Different]].",
    );
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
});

describe("markdown links (absolute)", () => {
  test("absolute path leading slash preserved", () => {
    expect(splice("See [t](/Old).", "[t](/Old)", "Old", "New", "Editor")).toBe(
      "See [t](/New).",
    );
  });
});

describe("markdown links (angle-wrapped)", () => {
  test("preserves angle wrapping when present", () => {
    expect(splice("[t](<Old>)", "[t](<Old>)", "Old", "New", "Editor")).toBe(
      "[t](<New>)",
    );
  });

  test("auto-wraps when the new name contains spaces", () => {
    expect(splice("[t](Old).", "[t](Old)", "Old", "New Name", "Editor")).toBe(
      "[t](<New Name>).",
    );
  });

  test("auto-wraps absolute path with spaces", () => {
    expect(splice("[t](/Old).", "[t](/Old)", "Old", "New Name", "Editor")).toBe(
      "[t](</New Name>).",
    );
  });
});

describe("transclusions (wikilink form with leading `!`)", () => {
  test("bare transclusion", () => {
    expect(splice("Embed ![[Old]] here.", "![[Old]]", "Old", "New")).toBe(
      "Embed ![[New]] here.",
    );
  });

  test("transclusion with alias", () => {
    expect(splice("See ![[Old|alias]].", "![[Old|alias]]", "Old", "New")).toBe(
      "See ![[New|alias]].",
    );
  });

  test("transclusion whose target doesn't match oldName is left alone", () => {
    expect(splice("See ![[Other]].", "![[Other]]", "Old", "New")).toBe(
      "See ![[Other]].",
    );
  });
});

describe("markdown images (markdown-link form with leading `!`)", () => {
  test("markdown image link to a page", () => {
    expect(
      splice("See ![alt](Old).", "![alt](Old)", "Old", "New", "Editor"),
    ).toBe("See ![alt](New).");
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
});

describe("write format", () => {
  test("rewrites a bare wiki link, which the index records as resolved", () => {
    const text = "See [[Notes]] here";
    expect(
      spliceReference({
        text,
        range: [4, 13],
        oldName: "bla/Notes",
        newName: "bla/Renamed",
        newWikiName: "Renamed",
        pageToEdit: "Editor",
      }),
    ).toBe("See [[Renamed]] here");
  });

  test("rewrites a qualified wiki link into shortest form", () => {
    const text = "See [[bla/Notes]] here";
    expect(
      spliceReference({
        text,
        range: [4, 17],
        oldName: "bla/Notes",
        newName: "bla/Renamed",
        newWikiName: "Renamed",
        pageToEdit: "Editor",
      }),
    ).toBe("See [[Renamed]] here");
  });

  test("full-path format writes the full name", () => {
    const text = "See [[Notes]] here";
    expect(
      spliceReference({
        text,
        range: [4, 13],
        oldName: "bla/Notes",
        newName: "bla/Renamed",
        newWikiName: "bla/Renamed",
        pageToEdit: "Editor",
      }),
    ).toBe("See [[bla/Renamed]] here");
  });

  test("alias and detail suffix survive a shortest-form rewrite", () => {
    const text = "See [[bla/Notes#Setup|the notes]] here";
    expect(
      spliceReference({
        text,
        range: [4, 33],
        oldName: "bla/Notes",
        newName: "bla/Renamed",
        newWikiName: "Renamed",
        pageToEdit: "Editor",
      }),
    ).toBe("See [[Renamed#Setup|the notes]] here");
  });

  test("markdown links ignore the wiki write format and stay full-path", () => {
    const text = "See [the notes](bla/Notes) here";
    expect(
      spliceReference({
        text,
        range: [4, 26],
        oldName: "bla/Notes",
        newName: "bla/Renamed",
        newWikiName: "Renamed",
        pageToEdit: "Editor",
      }),
    ).toBe("See [the notes](bla/Renamed) here");
  });
});

describe("caret (meta) links", () => {
  test("a caret link is kept up to date on rename", () => {
    const text = "See [[^Library/Std/Config]] here";
    expect(
      spliceReference({
        text,
        range: [4, 27],
        oldName: "Library/Std/Config",
        newName: "Library/Std/Settings",
        newWikiName: "Settings",
        pageToEdit: "Editor",
      }),
    ).toBe("See [[^Library/Std/Settings]] here");
  });

  test("a caret link is never shortened, even under shortest format", () => {
    // `newWikiName` is the shortened form; a caret link must ignore it, or
    // `^Library/Std/APIs/Tag` would collapse onto the concept page `Tag`.
    const text = "Ref [[^Library/Std/APIs/Tag]] here";
    const result = spliceReference({
      text,
      range: [4, 29],
      oldName: "Library/Std/APIs/Tag",
      newName: "Library/Std/APIs/Tag",
      newWikiName: "Tag",
      pageToEdit: "Editor",
    });
    expect(result).toBe("Ref [[^Library/Std/APIs/Tag]] here");
    expect(result).not.toContain("[[^Tag]]");
  });

  test("a caret link keeps its alias and anchor", () => {
    const text = "See [[^Library/Std/Config#Options|the options]] here";
    expect(
      spliceReference({
        text,
        range: [4, 47],
        oldName: "Library/Std/Config",
        newName: "Library/Std/Settings",
        newWikiName: "Settings",
        pageToEdit: "Editor",
      }),
    ).toBe("See [[^Library/Std/Settings#Options|the options]] here");
  });
});
