import { expect, test, vi } from "vitest";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import {
  collectDroppedFiles,
  uploadFiles,
  uploadPathExists,
} from "./file_drop_upload.ts";

function file(name: string, text: string): File {
  return new File([text], name);
}

test("existence checks distinguish missing files from storage failures", async () => {
  expect(
    await uploadPathExists(async () => {
      throw notFoundError;
    }, "Missing.txt"),
  ).toBe(false);
  await expect(
    uploadPathExists(async () => {
      throw new Error("network unavailable");
    }, "Existing.txt"),
  ).rejects.toThrow("network unavailable");
});

test("collects every file from a directory reader that returns multiple batches", async () => {
  const first = file("One.md", "one");
  const second = file("Two.txt", "two");
  let batch = 0;
  const entries = [first, second].map((f) => ({
    name: f.name,
    isFile: true,
    isDirectory: false,
    file: (done: (file: File) => void) => done(f),
  }));
  const directory = {
    name: "Notes",
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (done: (entries: unknown[]) => void) =>
        done(batch++ < entries.length ? [entries[batch - 1]] : []),
    }),
  };
  const transfer = {
    items: [{ kind: "file", webkitGetAsEntry: () => directory }],
    files: [first, second],
  } as unknown as DataTransfer;

  expect(
    (await collectDroppedFiles(transfer)).map((item) => item.path),
  ).toEqual(["Notes/One.md", "Notes/Two.txt"]);
});

test("falls back to transferred files when a file entry cannot be read", async () => {
  const uploaded = file("Draft.md", "# Draft");
  const transfer = {
    items: [
      {
        kind: "file",
        webkitGetAsEntry: () => ({
          isFile: true,
          name: uploaded.name,
          file: (_done: (file: File) => void, fail: (error: Error) => void) =>
            fail(new DOMException("Path does not exist", "NotFoundError")),
        }),
      },
    ],
    files: [uploaded],
  } as unknown as DataTransfer;

  expect(await collectDroppedFiles(transfer)).toEqual([
    { path: "Draft.md", file: uploaded },
  ]);
});

test("cancelling destination leaves all files unwritten", async () => {
  const writePage = vi.fn();
  const writeDocument = vi.fn();
  await uploadFiles(
    [{ path: "Note.md", file: file("Note.md", "hello") }],
    "Notes",
    {
      prompt: async () => undefined,
      exists: async () => false,
      writePage,
      writeDocument,
      notify: vi.fn(),
      refresh: vi.fn(),
      maxSizeBytes: 1024,
    },
  );
  expect(writePage).not.toHaveBeenCalled();
  expect(writeDocument).not.toHaveBeenCalled();
});

test("preflights collisions before writing and preserves nested paths", async () => {
  const writePage = vi.fn();
  const writeDocument = vi.fn();
  const prompt = vi
    .fn()
    .mockResolvedValueOnce("Archive")
    .mockResolvedValueOnce("Archive/Notes/One.md");
  await uploadFiles(
    [
      { path: "Notes/One.md", file: file("One.md", "one") },
      { path: "Notes/Two.txt", file: file("Two.txt", "two") },
    ],
    "Drafts",
    {
      prompt,
      exists: async (path) => path === "Archive/Notes/One.md",
      writePage,
      writeDocument,
      notify: vi.fn(),
      refresh: vi.fn(),
      maxSizeBytes: 1024,
    },
  );
  expect(writePage).toHaveBeenCalledWith("Archive/Notes/One", "one");
  expect(writeDocument).toHaveBeenCalledWith(
    "Archive/Notes/Two.txt",
    new Uint8Array([116, 119, 111]),
  );
  expect(prompt).toHaveBeenCalledTimes(2);
});

test("cancelling a collision prevents earlier files from being written", async () => {
  const writeDocument = vi.fn();
  const prompt = vi
    .fn()
    .mockResolvedValueOnce("Folder")
    .mockResolvedValueOnce(undefined);
  await uploadFiles(
    [
      { path: "One.txt", file: file("One.txt", "one") },
      { path: "Two.txt", file: file("Two.txt", "two") },
    ],
    "Folder",
    {
      prompt,
      exists: async (path) => path === "Folder/Two.txt",
      writePage: vi.fn(),
      writeDocument,
      notify: vi.fn(),
      refresh: vi.fn(),
      maxSizeBytes: 1024,
    },
  );
  expect(writeDocument).not.toHaveBeenCalled();
});

test("renaming a collision checks the new path before writing", async () => {
  const writeDocument = vi.fn();
  const seen: string[] = [];
  const prompt = vi
    .fn()
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("Copy.txt");
  await uploadFiles(
    [{ path: "Original.txt", file: file("Original.txt", "copy") }],
    "",
    {
      prompt,
      exists: async (path) => {
        seen.push(path);
        return path === "Original.txt";
      },
      writePage: vi.fn(),
      writeDocument,
      notify: vi.fn(),
      refresh: vi.fn(),
      maxSizeBytes: 1024,
    },
  );
  expect(seen).toEqual(["Original.txt", "Copy.txt"]);
  expect(writeDocument).toHaveBeenCalledWith(
    "Copy.txt",
    new Uint8Array([99, 111, 112, 121]),
  );
});

test("an invalid dropped path aborts the whole batch", async () => {
  const writeDocument = vi.fn();
  const notify = vi.fn();
  await uploadFiles(
    [
      { path: "Good.txt", file: file("Good.txt", "good") },
      { path: "../Bad.txt", file: file("Bad.txt", "bad") },
    ],
    "",
    {
      prompt: async () => "",
      exists: async () => false,
      writePage: vi.fn(),
      writeDocument,
      notify,
      refresh: vi.fn(),
      maxSizeBytes: 1024,
    },
  );
  expect(writeDocument).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining("Bad.txt"),
    "error",
  );
});

test("a failed write reports the path and continues with the remaining files", async () => {
  const notify = vi.fn();
  const refresh = vi.fn();
  const writeDocument = vi.fn(async (path: string) => {
    if (path === "Broken.txt") throw new Error("storage unavailable");
  });
  await uploadFiles(
    [
      { path: "Broken.txt", file: file("Broken.txt", "broken") },
      { path: "Good.txt", file: file("Good.txt", "good") },
    ],
    "",
    {
      prompt: async () => "",
      exists: async () => false,
      writePage: vi.fn(),
      writeDocument,
      notify,
      refresh,
      maxSizeBytes: 1024,
    },
  );
  expect(writeDocument).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining("Broken.txt"),
    "error",
  );
  expect(refresh).toHaveBeenCalledOnce();
});

test("an extensionless file keeps its name inside a folder containing a dot", async () => {
  const writeDocument = vi.fn();
  await uploadFiles([{ path: "LICENSE", file: file("LICENSE", "terms") }], "", {
    prompt: async () => "Archive.v1",
    exists: async () => false,
    writePage: vi.fn(),
    writeDocument,
    notify: vi.fn(),
    refresh: vi.fn(),
    maxSizeBytes: 1024,
  });
  expect(writeDocument).toHaveBeenCalledWith(
    "Archive.v1/LICENSE",
    new Uint8Array([116, 101, 114, 109, 115]),
  );
});
