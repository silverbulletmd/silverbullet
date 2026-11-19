// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const kits = vi.hoisted(() => ({ folderHasNotes: vi.fn() }));
vi.mock("../starter_kits.ts", () => kits);

import { useFolderHasNotes } from "./NewSpaceStarter.tsx";

let seen: boolean | undefined;
function Probe({ folder }: { folder: string }) {
  seen = useFolderHasNotes("admin", true, folder);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  kits.folderHasNotes.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

async function mount(folder: string) {
  const root = document.createElement("div");
  await act(async () => {
    render(h(Probe, { folder }), root);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  return root;
}

test("an empty folder is not checked and has no notes", async () => {
  await mount("  ");
  expect(kits.folderHasNotes).not.toHaveBeenCalled();
  expect(seen).toBe(false);
});

test("a folder is checked once typing settles", async () => {
  await mount("spaces/notes");
  expect(kits.folderHasNotes).toHaveBeenCalledWith("admin", "spaces/notes");
  expect(seen).toBe(true);
});
