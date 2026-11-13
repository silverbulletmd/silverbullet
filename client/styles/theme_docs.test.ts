import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "js-yaml";
import { describe, expect, test } from "vitest";
import { splitYamlDocuments } from "../../plugs/index/data_block.ts";
import { bundledThemeVariables, sourceFiles } from "./theme_variables.ts";

const stylesDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(stylesDir, "../..");
const themingDir = path.join(root, "docs/Theming");

function page(name: string): string {
  return readFileSync(path.join(themingDir, name), "utf8");
}

function dataObjects(name: string, tag: string): Record<string, unknown>[] {
  const text = page(name);
  const blocks = [
    ...text.matchAll(new RegExp(`^\`\`\`#${tag}\\n([\\s\\S]*?)^\`\`\``, "gm")),
  ];
  return blocks.flatMap((m) =>
    splitYamlDocuments(m[1])
      .filter((doc) => doc.text.trim())
      .map((doc) => YAML.load(doc.text) as Record<string, unknown>),
  );
}

/**
 * The groups Variables.md queries (`where v.group == "…"`): base groups come
 * before the `# Specific variables` heading, specific groups after it.
 */
function queriedGroups(): { base: string[]; specific: string[] } {
  const text = page("Variables.md");
  const split = text.indexOf("\n# Specific variables\n");
  const end = text.indexOf("\n# ", split + 1);
  const groups = (part: string) =>
    [...part.matchAll(/where v\.group == "([^"]+)"/g)].map((m) => m[1]);
  return {
    base: groups(text.slice(0, split)),
    specific: groups(text.slice(split, end < 0 ? undefined : end)),
  };
}

const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";
const SINCE = /^(edge|\d+\.\d+\.\d+(-[\w.]+)?)$/;
const STABILITY = ["stable", "experimental", "deprecated"];

describe("docs/Theming/Variables/Data.md", () => {
  const documented = dataObjects("Variables/Data.md", "theme-variable");
  const declared = bundledThemeVariables();

  test("documents exactly the variables the bundled theme declares", () => {
    const names = documented.map((v) => v.name as string);
    const undocumented = [...declared].filter((n) => !names.includes(n));
    const stale = names.filter((n) => !declared.has(n));
    expect(undocumented.sort(), "declared but not documented").toEqual([]);
    expect(stale.sort(), "documented but not declared").toEqual([]);
    expect(names.length, "documented twice").toBe(new Set(names).size);
  });

  test("every variable has a group, level, since and stability", () => {
    const invalid = documented.filter(
      (v) =>
        !nonEmpty(v.group) ||
        !["base", "specific"].includes(v.level as string) ||
        !SINCE.test(String(v.since)) ||
        !STABILITY.includes(v.stability as string) ||
        !nonEmpty(v.description),
    );
    expect(invalid.map((v) => v.name)).toEqual([]);
  });

  test("Variables.md lists every group, base and specific apart", () => {
    const { base, specific } = queriedGroups();
    expect(base.length).toBeGreaterThan(0);
    expect(specific.length).toBeGreaterThan(0);
    const misplaced = documented
      .filter(
        (v) =>
          !(v.level === "base" ? base : specific).includes(v.group as string),
      )
      .map((v) => `${v.name}: ${v.level} in "${v.group}"`);
    expect(misplaced).toEqual([]);
  });

  test("derivesFrom names declared variables", () => {
    const unknown = documented.flatMap((v) =>
      ((v.derivesFrom as string[] | undefined) ?? [])
        .filter((d) => !declared.has(d))
        .map((d) => `${v.name} → ${d}`),
    );
    expect(unknown).toEqual([]);
  });
});

describe("docs/Theming/Selectors/Data.md", () => {
  const documented = dataObjects("Selectors/Data.md", "theme-selector");

  test("every selector has a description, since and stability", () => {
    expect(documented.length).toBeGreaterThan(0);
    const invalid = documented.filter(
      (s) =>
        !nonEmpty(s.selector) ||
        !nonEmpty(s.description) ||
        !SINCE.test(String(s.since)) ||
        !STABILITY.includes(s.stability as string),
    );
    expect(invalid.map((s) => s.selector)).toEqual([]);
  });

  test("every class, id and attribute a selector names still exists", () => {
    const source = sourceFiles(
      ["client", "plugs"].map((dir) => path.join(root, dir)),
      /\.(scss|tsx?|html)$/,
    )
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    // A substring match over all source, so it catches removed names, not
    // ones that merely moved. `data-sb-theme` is set as `dataset.sbTheme`.
    const datasetKey = (name: string) =>
      name.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const exists = (name: string) =>
      source.includes(name) ||
      (name.startsWith("data-") && source.includes(`.${datasetKey(name)}`));
    const gone = documented.flatMap((s) =>
      [...(s.selector as string).matchAll(/[.#]([\w-]+)|\[([\w-]+)/g)]
        .map((m) => m[1] ?? m[2])
        .filter((name) => !exists(name))
        .map((name) => `${s.selector}: ${name}`),
    );
    expect(gone).toEqual([]);
  });
});
