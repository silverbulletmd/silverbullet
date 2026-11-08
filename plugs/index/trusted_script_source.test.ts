import { expect, test } from "vitest";
import {
  isTrustedScriptPage,
  assertEditorWritePath,
} from "../../plug-api/lib/trusted_script_source.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { lintLua } from "./lint.ts";
import type { PageMeta } from "../../plug-api/types/index.ts";
import type { LintEvent } from "../../plug-api/types/client.ts";
import { extractTrustedSpaceLuaFromPageText } from "../../client/boot_config.ts";

const text =
  "```space-lua\nvalue = 1\n```\n\n```space-style\nbody { color: red }\n```";
const tree = parseMarkdown(text);

test.each([
  "CONFIG",
  "Library/Example",
  "Library/Nested/Example",
  "Notes/Example",
  "config",
  "Notes/CONFIG",
  "LibraryOther/Example",
  "library/Example",
  "Library/../Notes/Example",
])("script location: %s", async (name) => {
  const allowed = [
    "CONFIG",
    "Library/Example",
    "Library/Nested/Example",
  ].includes(name);
  const meta = {
    name,
    ref: name,
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  } as PageMeta;
  expect(isTrustedScriptPage(name)).toBe(allowed);
  expect(await indexSpaceLua(meta, {}, tree)).toHaveLength(allowed ? 1 : 0);
  expect(await indexSpaceStyle(meta, {}, tree)).toHaveLength(allowed ? 1 : 0);
  expect(extractTrustedSpaceLuaFromPageText(name, text)).toBe(
    allowed ? "value = 1" : "",
  );
});

test("lint explains both unsupported block types outside trusted locations", async () => {
  const diagnostics = await lintLua({
    name: "Notes/Example",
    tree,
    text,
  } as LintEvent);
  expect(diagnostics).toHaveLength(2);
  expect(
    diagnostics.every(
      (d) => d.message.includes("Library/") && d.message.includes("CONFIG.md"),
    ),
  ).toBe(true);
});

test.each([
  "CONFIG.md",
  "Library/Example.md",
  "Library",
  "library/example.md",
  "config.md",
  "Library/../Notes/Example.md",
  "Notes/../CONFIG.md",
  "%4cibrary/Example.md",
  "Library\\Example.md",
])("editor cannot write protected or ambiguous path: %s", (path) => {
  expect(() => assertEditorWritePath(path)).toThrow();
  expect(() => assertEditorWritePath("Notes/Example.md", path)).toThrow();
  expect(() => assertEditorWritePath(path, "Notes/Example.md")).toThrow();
});

test.each(["Notes/Example.md", "Notes/CONFIG.md", "LibraryOther/Example.md"])(
  "ordinary page writes remain possible: %s",
  (path) => {
    expect(() => assertEditorWritePath(path)).not.toThrow();
  },
);
