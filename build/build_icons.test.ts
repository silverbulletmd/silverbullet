import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildIconData } from "./build_icons.ts";
import { CORE_ICON_NAMES } from "../plug-api/ui/icons/core_names.ts";
import { CORE_ICONS } from "../plug-api/ui/icons/core.generated.ts";

const lucideDir = join(import.meta.dirname, "../node_modules/lucide-static");
const built = await buildIconData(lucideDir);

test("ships the full Lucide set", () => {
  expect(Object.keys(built.data.icons).length).toBeGreaterThanOrEqual(2000);
});

test("Feather-era names resolve through Lucide's aliases", () => {
  for (const alias of ["check-square", "help-circle"]) {
    const target = built.data.aliases[alias];
    expect(target).toBeTypeOf("string");
    expect(built.data.icons[target]).toBeDefined();
  }
});

test("every alias points at a canonical icon", () => {
  for (const target of Object.values(built.data.aliases)) {
    expect(built.data.icons[target]).toBeDefined();
  }
});

test("search keywords are generated", () => {
  expect(built.keywords.house?.length).toBeGreaterThan(0);
});

test("every core name exists in Lucide", () => {
  for (const name of CORE_ICON_NAMES) {
    const canonical = built.data.aliases[name] ?? name;
    expect(built.data.icons[canonical], name).toBeDefined();
  }
});

function resolvesInCore(name: string): boolean {
  const canonical = CORE_ICONS.aliases[name] ?? name;
  return CORE_ICONS.icons[canonical] !== undefined;
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, exts, out);
    else if (exts.some((e) => path.endsWith(e))) out.push(path);
  }
  return out;
}

const root = join(import.meta.dirname, "..");

/** Icon names the built-in UI and Std library use, which must render on first paint. */
function builtinIconNames(): Set<string> {
  const names = new Set<string>();
  const add = (re: RegExp, text: string) => {
    for (const m of text.matchAll(re)) names.add(m[1]);
  };
  for (const file of walk(join(root, "libraries/Library/Std"), [".md"])) {
    add(/\bicon\s*=\s*"([a-z0-9-]+)"/g, readFileSync(file, "utf-8"));
  }
  for (const dir of ["client", "plug-api", "plugs"]) {
    for (const file of walk(join(root, dir), [".ts", ".tsx"])) {
      if (file.includes(".test.")) continue;
      const text = readFileSync(file, "utf-8");
      add(/<Icon[^>]*\bname="([a-z0-9-]+)"/g, text);
      add(/\bicon:\s*(?:\(\)\s*=>\s*)?"([a-z0-9-]+)"/g, text);
    }
  }
  return names;
}

/** `icon:` keys that hold something other than an icon name */
const NOT_ICON_NAMES = new Set([
  // The account menu's action-button name
  "profile",
  // Widget action ids (widget_menu.ts maps them to icons)
  "open",
  "reload",
  "remove",
  "revert",
  // A CSS class (plug-api/ui/button.tsx)
  "sb-button-icon",
]);

test("core icons cover every built-in icon name", () => {
  const missing = [...builtinIconNames()].filter(
    (n) => !NOT_ICON_NAMES.has(n) && !resolvesInCore(n),
  );
  expect(missing).toEqual([]);
});
