import { expect, test, vi } from "vitest";
import {
  onLibrariesFocus,
  requestLibrariesFocus,
  takeLibrariesFocus,
} from "./libraries_focus.ts";

test("a focus request is taken once", () => {
  requestLibrariesFocus("install");
  expect(takeLibrariesFocus()).toBe("install");
  expect(takeLibrariesFocus()).toBeUndefined();
});

test("listeners hear requests until they unsubscribe", () => {
  const listener = vi.fn();
  const off = onLibrariesFocus(listener);
  requestLibrariesFocus("updateAll");
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  requestLibrariesFocus("addRepository");
  expect(listener).toHaveBeenCalledTimes(1);
  takeLibrariesFocus();
});
