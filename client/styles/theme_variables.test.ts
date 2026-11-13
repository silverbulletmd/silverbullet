import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  bundledThemeVariables,
  declaredVariables,
  isLocalVariable,
  PUBLIC_API_VARIABLES,
  sourceFiles,
  usedVariables,
} from "./theme_variables.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("variable scanners", () => {
  test("declaredVariables and usedVariables", () => {
    expect(declaredVariables("html { --a: 1; --b-c:2 }")).toEqual(
      new Set(["--a", "--b-c"]),
    );
    expect(declaredVariables("a--b: 1; .x--y:hover {}")).toEqual(new Set());
    expect(usedVariables("color: var(--a, var(--b))")).toEqual(
      new Set(["--a", "--b"]),
    );
  });
});

describe("theme variable inventory", () => {
  const declared = bundledThemeVariables();
  const used = new Set<string>();
  for (const file of sourceFiles(
    ["client", "plugs"].map((dir) => path.join(root, dir)),
  )) {
    for (const name of usedVariables(readFileSync(file, "utf8"))) {
      used.add(name);
    }
  }

  test("every theme variable used in client/ and plugs/ is declared", () => {
    const undeclared = [...used]
      .filter((n) => !isLocalVariable(n) && !declared.has(n))
      .sort();
    expect(
      undeclared,
      `used but not declared:\n${undeclared.join("\n")}`,
    ).toEqual([]);
  });

  test("every declared theme variable is used", () => {
    const unused = [...declared]
      .filter((n) => !used.has(n) && !PUBLIC_API_VARIABLES.has(n))
      .sort();
    expect(unused, `declared but never used:\n${unused.join("\n")}`).toEqual(
      [],
    );
  });
});
