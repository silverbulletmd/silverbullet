import { afterEach, expect, test, vi } from "vitest";
import {
  folderHasNotes,
  kitPreviewUrl,
  listStarterKits,
  starterFor,
} from "./starter_kits.ts";

afterEach(() => vi.unstubAllGlobals());

test("starterFor maps choices", () => {
  expect(starterFor({ type: "kit", id: "k" }, "copy", "")).toEqual({
    type: "kit",
    id: "k",
  });
  expect(starterFor({ type: "git" }, "copy", "https://x/y")).toEqual({
    type: "git",
    url: "https://x/y",
  });
  expect(starterFor({ type: "git" }, "sync", "https://x/y")).toEqual({
    type: "none",
  });
});

test("preview url follows the base", () => {
  const kit = { id: "a b", hasPreview: true } as any;
  expect(kitPreviewUrl("admin", kit)).toBe(
    "api/admin/starter-kits/a%20b/preview",
  );
  expect(kitPreviewUrl("setup", kit)).toBe(
    "/.setup/api/starter-kits/a%20b/preview",
  );
  expect(kitPreviewUrl("admin", { ...kit, hasPreview: false })).toBeUndefined();
});

test("calls the right routes per base", async () => {
  const fetchMock = vi.fn(async (_u: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ hasNotes: true }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await folderHasNotes("setup", "a/b")).toBe(true);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/.setup/api/fs/has-notes?path=a%2Fb",
  );
  await folderHasNotes("admin", "x");
  expect(fetchMock.mock.calls[1][0]).toBe("api/admin/fs/has-notes?path=x");
  await listStarterKits("admin");
  expect(fetchMock.mock.calls[2][0]).toBe("api/admin/starter-kits");
});
