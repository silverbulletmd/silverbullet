import { describe, expect, test } from "vitest";
import { parseGitBlame } from "./git-blame.ts";

const COMMITTED = `3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c 1 1 2
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary Add the first line
filename notes.md
\tFirst line
`;

const UNCOMMITTED = `0000000000000000000000000000000000000000 2 2 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1700009999
author-tz +0000
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1700009999
committer-tz +0000
summary Version of notes.md from notes.md
filename notes.md
\tSecond line
`;

describe("parseGitBlame", () => {
  test("maps porcelain entries to gutter markers", () => {
    const markers = parseGitBlame(COMMITTED + UNCOMMITTED);

    expect(markers).toHaveLength(2);
    expect(markers[0]).toEqual({
      line: 1,
      text: "Alice",
      title: "Alice - 2023-11-14 - Add the first line",
      className: expect.stringMatching(/^git-blame-author-\d+$/),
      rev: "3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c",
      revisionLine: 1,
    });
  });

  test("treats the all-zero revision as uncommitted work", () => {
    const [marker] = parseGitBlame(UNCOMMITTED);

    expect(marker.rev).toBeUndefined();
    // Without a revision the marker points at the current document line.
    expect(marker.revisionLine).toBe(2);
    expect(marker.text).toBe("working");
  });

  test("keeps the revision line number, which differs from the current line", () => {
    const [marker] = parseGitBlame(
      COMMITTED.replace(
        "3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c 1 1 2",
        "3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c 7 42 2",
      ),
    );

    expect(marker.line).toBe(42);
    expect(marker.revisionLine).toBe(7);
  });

  test("names the author when it differs from the committer", () => {
    const [marker] = parseGitBlame(
      COMMITTED.replace("committer Alice", "committer Bob").replace(
        "summary Add the first line",
        "summary Landed by Bob",
      ),
    );

    expect(marker.text).toBe("Bob");
    expect(marker.title).toBe(
      "Bob - author: Alice - 2023-11-14 - Landed by Bob",
    );
  });

  test("accepts the boundary marker Git prints for the root commit", () => {
    const [marker] = parseGitBlame(
      COMMITTED.replace(
        "3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c 1 1 2",
        "^3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c 1 1 2",
      ),
    );

    expect(marker.rev).toBe("3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c");
  });

  test("ignores trailing headers that follow the last content line", () => {
    expect(parseGitBlame("")).toEqual([]);
    expect(parseGitBlame("not porcelain output\n")).toEqual([]);
    // A header without its content line produces no marker.
    expect(
      parseGitBlame(
        "3f2b1c9d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c 1 1 2\nauthor Alice\n",
      ),
    ).toEqual([]);
  });
});
