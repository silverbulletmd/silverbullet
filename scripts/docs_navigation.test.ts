import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { evalStatement } from "../client/space_lua/eval.ts";
import { parseBlock } from "../client/space_lua/parse.ts";
import {
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "../client/space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../client/space_lua/stdlib.ts";

type NavEntry = { name: string; ref: string; icon?: string };
type NavSection = { name: string; description: string };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "docs");
const librariesDir = path.join(root, "libraries");

const SECTIONS = [
  "Start",
  "Desktop",
  "Server",
  "Writing",
  "Linking & Exploring",
  "Queries & Data",
  "Customizing",
  "Working Together",
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
  const docsNav = luaValueToJS(env.get("docsNav"), sf);
  return {
    pages: asArray<NavEntry>(docsNav.pages),
    sections: asArray<NavSection>(docsNav.sections),
  };
}

function pageExists(ref: string): boolean {
  return (
    existsSync(path.join(docsDir, `${ref}.md`)) ||
    existsSync(path.join(librariesDir, `${ref}.md`))
  );
}

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? [full, ...allFiles(full)] : [full];
  });
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

test("no page appears twice and no tree path is reused", async () => {
  const { pages } = await loadNav();
  const dupes = (values: string[]) =>
    values.filter((v, i) => values.indexOf(v) !== i);
  expect(dupes(pages.map((p) => p.ref))).toEqual([]);
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

test("internal material stays out of docs/", () => {
  const relative = allFiles(docsDir).map((f) => path.relative(docsDir, f));
  const internal = relative.filter(
    (f) =>
      f.endsWith("Stress Test.md") ||
      f === "Inbox" ||
      f.startsWith("Inbox/") ||
      f === "superpowers" ||
      f.startsWith("superpowers/"),
  );
  expect(internal).toEqual([]);
});

test("every section has a landing page entry", async () => {
  const { pages, sections } = await loadNav();
  const roots = new Set(pages.map((p) => p.name));
  expect(sections.map((s) => s.name).filter((s) => !roots.has(s))).toEqual([]);
});
