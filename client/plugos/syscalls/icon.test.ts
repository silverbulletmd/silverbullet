import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, test, vi } from "vitest";

const resolveFeatherIcons =
  vi.fn<(names: string[]) => Record<string, string>>();

vi.mock("../../lib/feather_icons.ts", () => ({
  resolveFeatherIcons: (names: string[]) => resolveFeatherIcons(names),
}));

const { iconSyscalls } = await import("./icon.ts");

function callbacks() {
  const syscalls = iconSyscalls();
  return {
    feather: (syscalls["icon.feather"] as any).callback,
    resolveFeather: (syscalls["icon.resolveFeather"] as any).callback,
  };
}

test("icon.feather resolves a single name through the batch resolver", () => {
  resolveFeatherIcons.mockReturnValueOnce({ lock: "<svg>lock</svg>" });
  const { feather } = callbacks();

  expect(feather({}, "lock")).toBe("<svg>lock</svg>");
  expect(resolveFeatherIcons).toHaveBeenCalledWith(["lock"]);
});

test("icon.feather returns null for a name the resolver doesn't know", () => {
  resolveFeatherIcons.mockReturnValueOnce({});
  const { feather } = callbacks();

  expect(feather({}, "not-a-real-icon")).toBeNull();
});

test("icon.feather guards a missing name instead of throwing", () => {
  resolveFeatherIcons.mockClear();
  const { feather } = callbacks();

  expect(feather({}, undefined)).toBeNull();
  expect(resolveFeatherIcons).not.toHaveBeenCalled();
});

test("icon.resolveFeather passes the batch through unchanged", () => {
  const resolved = { lock: "<svg>lock</svg>", "trash-2": "<svg>trash</svg>" };
  resolveFeatherIcons.mockReturnValueOnce(resolved);
  const { resolveFeather } = callbacks();

  expect(resolveFeather({}, ["lock", "trash-2"])).toBe(resolved);
  expect(resolveFeatherIcons).toHaveBeenCalledWith(["lock", "trash-2"]);
});

test("icon.resolveFeather defaults a missing names argument to an empty batch", () => {
  resolveFeatherIcons.mockReturnValueOnce({});
  const { resolveFeather } = callbacks();

  resolveFeather({}, undefined);
  expect(resolveFeatherIcons).toHaveBeenCalledWith([]);
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
