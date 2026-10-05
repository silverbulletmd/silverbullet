import { expect, test } from "vitest";
import { isViewValue } from "../../navigator/view_value.ts";
import { navigatorSyscalls } from "./navigator.ts";

// view.* is canonical; navigator.* aliases the same callbacks.
test("navigatorSyscalls registers every view.* entry a second time under navigator.*, with the identical callback", () => {
  const syscalls = navigatorSyscalls();

  const viewNames = Object.keys(syscalls).filter((name) =>
    name.replace(/^lua:/, "").startsWith("view."),
  );
  expect(viewNames.length).toBeGreaterThan(0);

  for (const viewName of viewNames) {
    const isLuaNative = viewName.startsWith("lua:");
    const cleanViewName = isLuaNative
      ? viewName.slice("lua:".length)
      : viewName;
    const navigatorName =
      (isLuaNative ? "lua:" : "") +
      "navigator." +
      cleanViewName.slice("view.".length);

    expect(syscalls).toHaveProperty(navigatorName);
    const viewDef = syscalls[viewName];
    const navigatorDef = syscalls[navigatorName];
    // Both forms accept either a bare function or a `{ callback, ... }`
    // definition -- resolve to the callback either way.
    const viewCallback =
      typeof viewDef === "function" ? viewDef : viewDef.callback;
    const navigatorCallback =
      typeof navigatorDef === "function" ? navigatorDef : navigatorDef.callback;
    expect(navigatorCallback).toBe(viewCallback);
  }
});

test("navigatorSyscalls exposes the whole surface under both names: open, focus, moveByRename, define, pick", () => {
  const syscalls = navigatorSyscalls();

  for (const fn of ["open", "focus", "moveByRename"]) {
    expect(syscalls).toHaveProperty(`view.${fn}`);
    expect(syscalls).toHaveProperty(`navigator.${fn}`);
  }
  for (const fn of ["define", "pick"]) {
    expect(syscalls).toHaveProperty(`lua:view.${fn}`);
    expect(syscalls).toHaveProperty(`lua:navigator.${fn}`);
  }
});

test("widget.newLive syscall returns a Lua-native value without running its source", () => {
  const source = () => [];
  const definition = navigatorSyscalls()["lua:widget.newLive"];
  if (typeof definition === "function")
    throw new Error("missing syscall metadata");
  const value = definition.callback({}, { source });
  expect(isViewValue(value)).toBe(true);
  expect(value.spec.source).toBe(source);
});

test("view.new is gone under both names", () => {
  const syscalls = navigatorSyscalls();
  expect(syscalls["lua:view.new"]).toBeUndefined();
  expect(syscalls["lua:navigator.new"]).toBeUndefined();
  expect(syscalls["lua:widget.newLive"]).toBeDefined();
});
