import { describe, expect, test } from "vitest";
import { findManagedBlock, replaceManagedBlock } from "./config_block.ts";

const MARKER = "-- managed-by: configuration-ui";

describe("findManagedBlock", () => {
  test("finds block in simple config page", () => {
    const text = `Some text

\`\`\`space-lua
${MARKER}
config.set("shortWikiLinks", false)
\`\`\`
`;
    const result = findManagedBlock(text);
    expect(result).not.toBeNull();
    expect(result!.innerContent).toContain(MARKER);
    expect(result!.innerContent).toContain("shortWikiLinks");
  });

  test("returns null when no managed block exists", () => {
    const text = `Some text

\`\`\`space-lua
config.set("vim", {})
\`\`\`
`;
    expect(findManagedBlock(text)).toBeNull();
  });

  test("finds correct block when multiple space-lua blocks exist", () => {
    const text = `\`\`\`space-lua
config.set("other", true)
\`\`\`

\`\`\`space-lua
${MARKER}
config.set("a", 1)
\`\`\`
`;
    const result = findManagedBlock(text);
    expect(result).not.toBeNull();
    expect(result!.innerContent).toContain('"a", 1');
    expect(result!.innerContent).not.toContain('"other"');
  });
});

describe("replaceManagedBlock", () => {
  test("replaces existing managed block", () => {
    const text = `Intro text

\`\`\`space-lua
${MARKER}
config.set("old", true)
\`\`\`

Trailing text
`;
    const newContent = `${MARKER}\nconfig.set("new", true)`;
    const result = replaceManagedBlock(text, newContent);
    expect(result).toContain('"new", true');
    expect(result).not.toContain('"old", true');
    expect(result).toContain("Intro text");
    expect(result).toContain("Trailing text");
  });

  test("appends new block when none exists", () => {
    const text = `Intro text

\`\`\`space-lua
config.set("manual", true)
\`\`\`
`;
    const newContent = `${MARKER}\nconfig.set("ui", true)`;
    const result = replaceManagedBlock(text, newContent);
    expect(result).toContain("manual");
    expect(result).toContain('"ui", true');
    expect(result).toContain("\`\`\`space-lua\n" + newContent + "\n\`\`\`");
  });

  test("removes managed block when new content is empty", () => {
    const text = `Intro

\`\`\`space-lua
${MARKER}
config.set("old", true)
\`\`\`

End
`;
    const result = replaceManagedBlock(text, "");
    expect(result).not.toContain(MARKER);
    expect(result).toContain("Intro");
    expect(result).toContain("End");
  });
});
