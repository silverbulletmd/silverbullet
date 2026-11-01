import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { evalStatement } from "../client/space_lua/eval.ts";
import { parseBlock } from "../client/space_lua/parse.ts";
import {
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "../client/space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../client/space_lua/stdlib.ts";

type NavEntry = { name: string; ref: string; icon?: string };
type NavSection = { name: string; description: string };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "docs");
const librariesDir = path.join(root, "libraries");

const SECTIONS = [
  "SilverBullet",
  "CHANGELOG",
  "Start here",
  "Guides",
  "Setup and administration",
  "Reference",
  "Contributing",
];

function navBlock(): string {
  const text = readFileSync(path.join(docsDir, "Library/Website.md"), "utf8");
  const blocks = [...text.matchAll(/^```space-lua\n([\s\S]*?)^```/gm)].map(
    (m) => m[1],
  );
  const block = blocks.find((b) => b.includes("docsNav.pages = {"));
  if (!block) throw new Error("No space-lua block defines docsNav.pages");
  return block;
}

function asArray<T>(value: unknown): T[] {
  return (Array.isArray(value) ? value : Object.values(value as object)) as T[];
}

async function loadNav(): Promise<{
  pages: NavEntry[];
  sections: NavSection[];
}> {
  const ast = parseBlock(navBlock());
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);
  await evalStatement(ast, env, sf, false);
  const docsNav = env.get("docsNav") as LuaTable;
  // Sections mix fields with child nodes, which luaValueToJS would turn into
  // a plain array, so pick their fields from the Lua table.
  const sections = docsNav.get("sections") as LuaTable;
  return {
    pages: asArray<NavEntry>(luaValueToJS(docsNav.get("pages"), sf)),
    sections: Array.from({ length: sections.length }, (_, i) => {
      const section = sections.get(i + 1) as LuaTable;
      return {
        name: section.get("name") as string,
        description: section.get("description") as string,
      };
    }),
  };
}

function pageExists(ref: string): boolean {
  ref = ref.split("#")[0];
  return (
    existsSync(path.join(docsDir, `${ref}.md`)) ||
    existsSync(path.join(librariesDir, `${ref}.md`))
  );
}

test("sections are the documented sections, in order", async () => {
  const { sections } = await loadNav();
  expect(sections.map((s) => s.name)).toEqual(SECTIONS);
  for (const s of sections) expect(s.description).toBeTruthy();
});

test("every entry sits under a known section", async () => {
  const { pages } = await loadNav();
  const outside = pages.filter((p) => !SECTIONS.includes(p.name.split("/")[0]));
  expect(outside.map((p) => p.name)).toEqual([]);
});

test("every ref resolves to an existing page", async () => {
  const { pages } = await loadNav();
  const missing = pages.filter((p) => !pageExists(p.ref)).map((p) => p.ref);
  expect(missing).toEqual([]);
});

test("no tree path is reused", async () => {
  const { pages } = await loadNav();
  const dupes = (values: string[]) =>
    values.filter((v, i) => values.indexOf(v) !== i);
  expect(dupes(pages.map((p) => p.name))).toEqual([]);
});

test("a parent entry comes before its children", async () => {
  const { pages } = await loadNav();
  const position = new Map(pages.map((p, i) => [p.name, i]));
  const misordered: string[] = [];
  pages.forEach((p, i) => {
    const segments = p.name.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      const parent = segments.slice(0, depth).join("/");
      const at = position.get(parent);
      if (at !== undefined && at > i) misordered.push(p.name);
    }
  });
  expect(misordered).toEqual([]);
});

test("every section has a landing page entry", async () => {
  const { pages, sections } = await loadNav();
  const roots = new Set(pages.map((p) => p.name));
  expect(sections.map((s) => s.name).filter((s) => !roots.has(s))).toEqual([]);
});

test("practical topic sections contain guides rather than feature references", async () => {
  const { pages } = await loadNav();
  const topics = ["Start here/", "Guides/"];
  const misplaced = pages.filter(
    (entry) =>
      topics.some((topic) => entry.name.startsWith(topic)) &&
      !entry.ref.startsWith("Guide/") &&
      !["Use Cases", "Customizing"].includes(entry.ref),
  );
  expect(misplaced.map((entry) => entry.ref)).toEqual([]);
});

test("core feature contracts remain reachable under Reference", async () => {
  const { pages } = await loadNav();
  const references = new Set(
    pages
      .filter((entry) => entry.name.startsWith("Reference/"))
      .map((entry) => entry.ref),
  );
  for (const ref of [
    "Page",
    "Markdown",
    "Attribute",
    "Tag",
    "Workbench/Query",
    "Workbench/Configuration",
    "Space Lua",
    "API",
    "Revisions",
    "Desktop Sync",
    "Sync",
    "Share",
    "Install/Configuration",
    "Security",
    "CLI",
    "Plugs/Development/Document Editors",
  ])
    expect(references.has(ref), ref).toBe(true);
});

test("reference entries belong to one of four categories", async () => {
  const { pages } = await loadNav();
  const categories = new Set(
    pages
      .filter((entry) => entry.name.startsWith("Reference/"))
      .map((entry) => entry.name.split("/")[1]),
  );
  expect([...categories]).toEqual([
    "Markdown and page content",
    "SilverBullet interface and features",
    "Space Lua and APIs",
    "Technical reference",
  ]);
});

test("navigation heading links resolve", async () => {
  const { pages } = await loadNav();
  for (const entry of pages.filter((entry) => entry.ref.includes("#"))) {
    const [page, heading] = entry.ref.split("#");
    const source = readFileSync(path.join(docsDir, `${page}.md`), "utf8");
    expect(
      source.split("\n").some((line) => line.replace(/^#+ /, "") === heading),
      entry.ref,
    ).toBe(true);
  }
});
