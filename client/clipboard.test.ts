import { afterEach, expect, test, vi } from "vitest";
import { copyToClipboard } from "./clipboard.ts";

afterEach(() => vi.unstubAllGlobals());

test("HTTP text copying selects the text and restores focus even when copying fails", async () => {
  const field = {
    value: "",
    style: {},
    select: vi.fn(),
    remove: vi.fn(),
    setAttribute: vi.fn(),
  };
  const focused = { focus: vi.fn() };
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", {
    activeElement: focused,
    getSelection: () => null,
    createElement: () => field,
    body: { appendChild: vi.fn() },
    execCommand: () => {
      expect(field.value).toBe("Field notes");
      expect(field.select).toHaveBeenCalled();
      return false;
    },
  });
  await expect(copyToClipboard("Field notes")).rejects.toThrow("copy");
  expect(field.remove).toHaveBeenCalled();
  expect(focused.focus).toHaveBeenCalled();
});

test("HTTP binary copying reports the missing capability", async () => {
  vi.stubGlobal("navigator", {});
  await expect(
    copyToClipboard(new Blob(["image"], { type: "image/png" })),
  ).rejects.toThrow("HTTPS");
});
