import { describe, expect, test } from "vitest";
import {
  libraryLabel,
  parseRequires,
  removeBlockedMessage,
  requiredBy,
  requirersOf,
  resolveLibraryUri,
  sameLibraryUri,
} from "./library_requires.ts";

const PAPER =
  "github:silverbulletmd/silverbullet-libraries@main/Library/silverbulletmd/Themes/Paper.md";
const LORA =
  "github:silverbulletmd/silverbullet-libraries@main/Library/silverbulletmd/Fonts/Lora.md";

describe("resolveLibraryUri", () => {
  test.each([
    ["a full URI stays as written", PAPER, LORA, LORA],
    [
      "https too",
      PAPER,
      "https://example.com/A.md",
      "https://example.com/A.md",
    ],
    [
      "a sibling",
      PAPER,
      "Ink.md",
      `${PAPER.slice(0, -"Paper.md".length)}Ink.md`,
    ],
    [
      "./ is the same folder",
      PAPER,
      "./Ink.md",
      `${PAPER.slice(0, -"Paper.md".length)}Ink.md`,
    ],
    [
      "../ climbs a folder, keeping repo and ref",
      PAPER,
      "../Fonts/Lora.md",
      LORA,
    ],
    [
      "github: without a ref",
      "github:acme/libs/Themes/Paper.md",
      "../Fonts/Lora.md",
      "github:acme/libs/Fonts/Lora.md",
    ],
    [
      "a github.com file URL keeps its blob and ref",
      "https://github.com/acme/libs/blob/dev/Themes/Paper.md",
      "../Fonts/Lora.md",
      "https://github.com/acme/libs/blob/dev/Fonts/Lora.md",
    ],
    [
      "any other https URL",
      "https://example.com/libs/Themes/Paper.md",
      "../Fonts/Lora.md",
      "https://example.com/libs/Fonts/Lora.md",
    ],
    [
      "a release (ghr:)",
      "ghr:acme/libs@1.2.0/Themes/Paper.md",
      "../Fonts/Lora.md",
      "ghr:acme/libs@1.2.0/Fonts/Lora.md",
    ],
  ])("%s", (_, base, entry, expected) => {
    expect(resolveLibraryUri(base, entry)).toBe(expected);
  });

  test("climbing above the repository can't resolve", () => {
    expect(
      resolveLibraryUri("github:acme/libs@main/Paper.md", "../Lora.md"),
    ).toBeUndefined();
    expect(
      resolveLibraryUri("https://example.com/Paper.md", "../../Lora.md"),
    ).toBeUndefined();
  });

  test("an entry starting with / can't resolve", () => {
    expect(resolveLibraryUri(PAPER, "/Library/Lora.md")).toBeUndefined();
  });

  test("a relative entry without a URI to resolve against can't resolve", () => {
    expect(resolveLibraryUri(undefined, "../Lora.md")).toBeUndefined();
    expect(resolveLibraryUri(undefined, LORA)).toBe(LORA);
  });
});

describe("parseRequires", () => {
  test("resolves each entry, skipping blanks and non-strings, and says why the rest can't be used", () => {
    expect(
      parseRequires(
        ["../Fonts/Lora.md", 3, "../../../../x.md", " ", "/Lora.md"],
        PAPER,
      ),
    ).toEqual({
      uris: [LORA],
      errors: [
        `"../../../../x.md", which doesn't resolve against ${PAPER}`,
        '"/Lora.md": start a relative path with ./ or ../, or give a full URI',
      ],
    });
  });

  test("anything but a list is no requirements", () => {
    const none = { uris: [], errors: [] };
    expect(parseRequires(undefined, PAPER)).toEqual(none);
    expect(parseRequires("../Fonts/Lora.md", PAPER)).toEqual(none);
  });
});

describe("sameLibraryUri", () => {
  test.each([
    [LORA, LORA, true],
    [
      "https://github.com/silverbulletmd/silverbullet-libraries/blob/main/Library/silverbulletmd/Fonts/Lora.md",
      LORA,
      true,
    ],
    [
      "github:silverbulletmd/silverbullet-libraries/Library/silverbulletmd/Fonts/Lora.md",
      LORA,
      true,
    ],
    [LORA.replace("@main", "@dev"), LORA, false],
    ["https://example.com/Lora.md", LORA, false],
  ])("%s vs %s", (a, b, same) => {
    expect(sameLibraryUri(a, b)).toBe(same);
  });
});

describe("who requires a library", () => {
  const installed = [
    { name: "Library/silverbulletmd/Fonts/Lora", uri: LORA },
    {
      name: "Library/silverbulletmd/Themes/Paper",
      uri: PAPER,
      requires: [LORA],
    },
    {
      name: "Library/acme/Ink",
      uri: "github:acme/ink@main/Ink.md",
      requires: [
        "https://github.com/silverbulletmd/silverbullet-libraries/blob/main/Library/silverbulletmd/Fonts/Lora.md",
      ],
    },
    // Requires itself: never blocks its own removal
    { name: "Library/acme/Loop", uri: "u", requires: ["u"] },
  ];

  test("lists the installed libraries whose requirements it meets", () => {
    expect(requirersOf(installed, "Library/silverbulletmd/Fonts/Lora")).toEqual(
      ["Library/silverbulletmd/Themes/Paper", "Library/acme/Ink"],
    );
    expect(
      requirersOf(installed, "Library/silverbulletmd/Themes/Paper"),
    ).toEqual([]);
    expect(requirersOf(installed, "Library/acme/Loop")).toEqual([]);
    expect(requirersOf(installed, "Library/Missing")).toEqual([]);
  });

  test("libraries in a circle with it don't keep it installed, or none could go", () => {
    const circle = [
      { name: "Library/A", uri: "a", requires: ["b"] },
      { name: "Library/B", uri: "b", requires: ["c"] },
      { name: "Library/C", uri: "c", requires: ["a"] },
      { name: "Library/D", uri: "d", requires: ["a"] },
    ];
    expect(requirersOf(circle, "Library/A")).toEqual(["Library/D"]);
    expect(requirersOf(circle, "Library/B")).toEqual([]);
    // Still shown as what they are
    expect(requiredBy(circle, "Library/A")).toEqual(["Library/C", "Library/D"]);
    expect(requiredBy(circle, "Library/B")).toEqual(["Library/A"]);
  });

  test("the message names them by their short names", () => {
    expect(
      removeBlockedMessage(
        "Library/silverbulletmd/Fonts/Lora",
        ["Library/silverbulletmd/Themes/Paper"],
        libraryLabel,
      ),
    ).toBe("Paper requires Lora. Remove Paper first.");
    expect(
      removeBlockedMessage(
        "Library/silverbulletmd/Fonts/Lora",
        ["Library/silverbulletmd/Themes/Paper", "Library/acme/Ink"],
        libraryLabel,
      ),
    ).toBe("Paper and Ink require Lora. Remove Paper and Ink first.");
  });
});

test("libraryLabel is the last segment of a page name or URI, without .md", () => {
  expect(libraryLabel("Library/silverbulletmd/Fonts/Lora")).toBe("Lora");
  expect(libraryLabel(LORA)).toBe("Lora");
  expect(libraryLabel("Solo")).toBe("Solo");
});
