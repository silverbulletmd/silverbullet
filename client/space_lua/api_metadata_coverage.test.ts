import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import ts from "typescript";
import { expect, test } from "vitest";
import { isILuaFunction, type LuaEnv, LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

function collectUndocumentedBuiltins(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  undocumented: string[],
): void {
  if (isILuaFunction(value)) {
    if (!value.info?.description?.trim()) undocumented.push(path);
    return;
  }
  if (!(value instanceof LuaTable) || seen.has(value)) return;
  seen.add(value);
  for (const key of value.keys()) {
    if (typeof key !== "string") continue;
    collectUndocumentedBuiltins(
      value.rawGet(key),
      `${path}.${key}`,
      seen,
      undocumented,
    );
  }
}

test("every standard-environment function has a description", () => {
  const env: LuaEnv = luaBuildStandardEnv();
  const undocumented: string[] = [];
  const seen = new WeakSet<object>();
  for (const name of env.keys()) {
    if (name === "_G") continue;
    collectUndocumentedBuiltins(env.get(name), name, seen, undocumented);
  }
  expect(undocumented.sort()).toEqual([]);
});

test("standard-library function names are derived from their environment path", () => {
  const stdlibDir = join(import.meta.dirname, "stdlib");
  const paths = [
    join(import.meta.dirname, "stdlib.ts"),
    ...readdirSync(stdlibDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(stdlibDir, name)),
  ];
  const explicitNames: string[] = [];

  for (const path of paths) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ["LuaBuiltinFunction", "LuaNativeJSFunction"].includes(
          node.expression.getText(source),
        )
      ) {
        const definition = node.arguments?.[0];
        if (definition && ts.isObjectLiteralExpression(definition)) {
          const name = definition.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              propertyName(property.name, source) === "name",
          );
          if (name) {
            const line =
              source.getLineAndCharacterOfPosition(name.getStart()).line + 1;
            explicitNames.push(
              `${relative(import.meta.dirname, path)}:${line}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  expect(explicitNames).toEqual([]);
});

function propertyName(node: ts.PropertyName, source: ts.SourceFile): string {
  return node.getText(source).replace(/^["']|["']$/g, "");
}

function hasInlineDescription(
  initializer: ts.Expression,
  source: ts.SourceFile,
): boolean {
  if (!ts.isObjectLiteralExpression(initializer)) return false;
  return initializer.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name, source) === "description" &&
      (ts.isStringLiteral(property.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(property.initializer)),
  );
}

test("every static syscall registration has an inline description", () => {
  const syscallDir = join(import.meta.dirname, "..", "plugos", "syscalls");
  const undocumented: string[] = [];
  let syscallCount = 0;
  for (const filename of readdirSync(syscallDir).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  )) {
    const path = join(syscallDir, filename);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node.name, source);
        if (/^(?:lua:)?[A-Za-z][\w-]*(?:\.[\w-]+)+$/.test(name)) {
          syscallCount++;
          if (!hasInlineDescription(node.initializer, source)) {
            undocumented.push(`${filename}: ${name}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(syscallCount).toBeGreaterThan(0);
  expect(undocumented.sort()).toEqual([]);
});

test("every built-in plug syscall has an inline description", () => {
  const plugsDir = join(import.meta.dirname, "..", "..", "plugs");
  const undocumented: string[] = [];
  let syscallCount = 0;
  for (const directory of readdirSync(plugsDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  )) {
    const directoryPath = join(plugsDir, directory.name);
    for (const filename of readdirSync(directoryPath).filter((name) =>
      name.endsWith(".plug.yaml"),
    )) {
      const manifest = yaml.load(
        readFileSync(join(directoryPath, filename), "utf8"),
      ) as {
        functions?: Record<
          string,
          { syscall?: string | { name?: string; description?: string } }
        >;
      };
      for (const [functionName, definition] of Object.entries(
        manifest.functions ?? {},
      )) {
        if (!definition.syscall) continue;
        syscallCount++;
        if (
          typeof definition.syscall === "string" ||
          !definition.syscall.description?.trim()
        ) {
          undocumented.push(`${filename}: ${functionName}`);
        }
      }
    }
  }
  expect(syscallCount).toBeGreaterThan(0);
  expect(undocumented.sort()).toEqual([]);
});
