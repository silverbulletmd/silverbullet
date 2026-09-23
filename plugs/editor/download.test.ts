import { beforeEach, expect, test, vi } from "vitest";

const editor = {
  getCurrentPath: vi.fn<() => Promise<string>>(),
  downloadSpaceFile: vi.fn<(name: string) => Promise<void>>(),
  flashNotification: vi.fn<(message: string, kind: string) => Promise<void>>(),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({ editor }));

const { downloadCurrentFile } = await import("./download.ts");

beforeEach(() => {
  vi.clearAllMocks();
  editor.getCurrentPath.mockResolvedValue("Notes/Guide.md");
  editor.downloadSpaceFile.mockResolvedValue();
  editor.flashNotification.mockResolvedValue();
});

test("File: Download exports the current page as Markdown", async () => {
  await downloadCurrentFile();
  expect(editor.downloadSpaceFile).toHaveBeenCalledWith("Notes/Guide.md");
});

test("File: Download exports the current document with its filename", async () => {
  editor.getCurrentPath.mockResolvedValue("Pictures/map.png");
  await downloadCurrentFile();
  expect(editor.downloadSpaceFile).toHaveBeenCalledWith("Pictures/map.png");
});

test("File: Download reports an unavailable file", async () => {
  editor.downloadSpaceFile.mockRejectedValue(new Error("not found"));
  await downloadCurrentFile();
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "Could not download Notes/Guide.md",
    "error",
  );
});
