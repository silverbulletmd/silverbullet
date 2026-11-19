import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, test, vi } from "vitest";

import { useFullIcons } from "../../../plug-api/ui/icons/test_icons.ts";

const { iconSyscalls } = await import("./icon.ts");

function cb(name: string) {
  return (iconSyscalls()[name] as any).callback;
}

test("icon.svg renders a Lucide icon", async () => {
  useFullIcons();
  expect(await cb("icon.svg")({}, "book")).toContain("lucide-book");
});

test("icon.svg returns nil for an unknown name", async () => {
  useFullIcons();
  expect(await cb("icon.svg")({}, "nope")).toBeNull();
});

test("icon.svg resolves a deprecated name to its replacement", async () => {
  useFullIcons();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await cb("icon.svg")({}, "md-home")).toContain("lucide-house");
});

test("icon.resolve omits unknown names, keyed by the input name", async () => {
  useFullIcons();
  const out = await cb("icon.resolve")({}, ["book", "nope"]);
  expect(Object.keys(out)).toEqual(["book"]);
});

test("icon.names lists canonical names", async () => {
  useFullIcons();
  const names: string[] = await cb("icon.names")({});
  expect(names).toContain("house");
  expect(names.length).toBeGreaterThan(2000);
});

test("deprecated icon.feather accepts the feather: prefix", async () => {
  useFullIcons();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await cb("icon.feather")({}, "feather:lock")).toContain("lucide-lock");
  expect(await cb("icon.feather")({}, undefined)).toBeNull();
});

test("deprecated icon.resolveFeather maps to icon.resolve", async () => {
  useFullIcons();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(Object.keys(await cb("icon.resolveFeather")({}, ["lock"]))).toEqual([
    "lock",
  ]);
  expect(await cb("icon.resolveFeather")({}, undefined)).toEqual({});
});

test("client_system.ts registers the icon syscalls", () => {
  const path = join(import.meta.dirname, "..", "..", "client_system.ts");
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let registered = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source).endsWith("registerSyscalls") &&
      node.arguments.some(
        (arg) =>
          ts.isCallExpression(arg) &&
          arg.expression.getText(source) === "iconSyscalls",
      )
    ) {
      registered = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(registered).toBe(true);
});
