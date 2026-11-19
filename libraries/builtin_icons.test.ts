import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildIconData } from "../build/build_icons.ts";

const root = join(import.meta.dirname, "..");
const { data } = await buildIconData(join(root, "node_modules/lucide-static"));

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (path.endsWith(ext)) out.push(path);
  }
  return out;
}

function nonCanonical(files: string[], re: RegExp): string[] {
  const bad: string[] = [];
  for (const file of files) {
    for (const m of readFileSync(file, "utf-8").matchAll(re)) {
      // "profile" is the action-button name for the account menu, not an icon
      if (m[1] !== "profile" && !data.icons[m[1]])
        bad.push(`${file.slice(root.length + 1)}: ${m[1]}`);
    }
  }
  return bad;
}

test("the Std library uses canonical Lucide icon names", () => {
  const files = walk(join(root, "libraries"), ".md");
  expect(
    nonCanonical(files, /\bicon\s*=\s*(?:"|\[\[)([^"\]]+)(?:"|\]\])/g),
  ).toEqual([]);
});

test("plug manifests use canonical Lucide icon names", () => {
  const files = walk(join(root, "plugs"), ".plug.yaml");
  expect(nonCanonical(files, /\bicon:\s*"?([a-z0-9:-]+)"?/g)).toEqual([]);
});
