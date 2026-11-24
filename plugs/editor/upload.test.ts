import { beforeEach, expect, test, vi } from "vitest";

const editor = {
  prompt:
    vi.fn<(message: string, def: string) => Promise<string | undefined>>(),
  getCurrentPath: vi.fn(async () => "Journal/Today.md"),
  getCurrentEditor: vi.fn(async () => "page"),
  insertAtCursor: vi.fn(),
  flashNotification: vi.fn(),
  uploadFile: vi.fn(),
};
const space = {
  fileExists: vi.fn(async (_name: string) => false),
  writeDocument: vi.fn(),
};
const system = {
  getConfig: vi.fn(async (_key: string, fallback: unknown) => fallback),
};
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  editor,
  space,
  system,
}));

const { saveFile, uploadFileTo } = await import("./upload.ts");

const file = {
  name: "logo.png",
  contentType: "image/png",
  content: new Uint8Array([1]),
};

beforeEach(() => {
  vi.clearAllMocks();
  editor.prompt.mockImplementation(async (_message, def) => def);
});

test("an upload starts next to the current page and links it there", async () => {
  expect(await saveFile(file)).toBe("Journal/logo.png");
  expect(space.writeDocument).toHaveBeenCalledWith(
    "Journal/logo.png",
    file.content,
  );
  expect(editor.insertAtCursor).toHaveBeenCalled();
});

test("an upload into a folder starts there and inserts nothing", async () => {
  editor.uploadFile.mockResolvedValue(file);

  await uploadFileTo("Projects");
  await uploadFileTo("");

  expect(space.writeDocument.mock.calls.map(([path]) => path)).toEqual([
    "Projects/logo.png",
    "logo.png",
  ]);
  expect(editor.insertAtCursor).not.toHaveBeenCalled();
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "Uploaded Projects/logo.png",
  );
});
