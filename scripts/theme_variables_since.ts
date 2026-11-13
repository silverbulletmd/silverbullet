// Prints the first release that contained each theme variable declared in the
// bundled theme SCSS, and each selector given, to seed `since` in
// docs/Theming/Variables.md and Selectors.md. Run once; `since` is maintained
// by hand afterwards, so this is not part of CI.
//
//   npx tsx scripts/theme_variables_since.ts [--selectors <selector>[=<search>] ...]
//
// A variable is searched as its declaration (`--name:`) or its first read
// (`var(--name`), whichever came first: some variables were read with a
// fallback, and so could be set, releases before the bundled CSS declared them.
// A selector is searched as the text after `=`, else its last class, id or
// attribute name, e.g. `.sb-hashtag[data-tag-name]` searches `data-tag-name`.
//
// "First release" is the oldest release tag (a tag starting with a digit) that
// contains the oldest commit adding that text; `edge` when no release has it.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledThemeVariables } from "../client/styles/theme_variables.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args: string[]): string[] {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function since(pickaxe: string[]): string {
  // Docs and changelog mention names before and after they exist in code.
  const [first] = git([
    "log",
    "--reverse",
    ...pickaxe,
    "--format=%h",
    "--",
    ".",
    ":(exclude)*.md",
  ]);
  if (!first) return "edge";
  const release = git(["tag", "--contains", first, "--sort=creatordate"]).find(
    (t) => /^\d/.test(t),
  );
  return release ?? "edge";
}

function selectorSearch(spec: string): [string, string] {
  const eq = spec.lastIndexOf("=");
  if (eq > 0 && !spec.slice(eq).includes("]")) {
    return [spec.slice(0, eq), spec.slice(eq + 1)];
  }
  const names = [...spec.matchAll(/[.#]([\w-]+)|\[([\w-]+)/g)].map(
    (m) => m[1] ?? m[2],
  );
  return [spec, names.at(-1) ?? spec];
}

const variables = [...bundledThemeVariables()].sort();

for (const name of variables) {
  // A whole-name match, so `--editor-font` doesn't match `--editor-font-size`
  const declaredOrRead = `(^|[^[:alnum:]_-])${name}[[:space:]]*:|var\\([[:space:]]*${name}([^[:alnum:]_-]|$)`;
  console.log(
    `${name}\t${since(["--extended-regexp", `-G${declaredOrRead}`])}`,
  );
}

const at = process.argv.indexOf("--selectors");
if (at >= 0) {
  for (const spec of process.argv.slice(at + 1)) {
    const [selector, search] = selectorSearch(spec);
    console.log(`${selector}\t${since([`-S${search}`])}`);
  }
}
