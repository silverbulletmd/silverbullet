import { expect, test } from "vitest";
import {
  type FsDirHandle,
  type FsFile,
  type FsFileHandle,
  type FsWritableStream,
  FileSystemAccessSpacePrimitives,
} from "./fs_access_space_primitives.ts";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";

class FakeFile {
  lastModified: number;
  constructor(
    public name: string,
    public content: Uint8Array,
  ) {
    this.lastModified = Date.now();
  }
  get size(): number {
    return this.content.byteLength;
  }
  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.content.slice().buffer);
  }
}

class FakeWritable implements FsWritableStream {
  private chunks: Uint8Array[] = [];
  constructor(private file: FakeFile) {}
  async write(data: Uint8Array): Promise<void> {
    this.chunks.push(new Uint8Array(data));
  }
  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      merged.set(c, off);
      off += c.length;
    }
    this.file.content = merged;
    this.file.lastModified = Date.now();
  }
}

class FakeFileHandle implements FsFileHandle {
  readonly kind = "file" as const;
  constructor(
    public name: string,
    private file: FakeFile,
  ) {}
  getFile(): Promise<FsFile> {
    return Promise.resolve(this.file);
  }
  createWritable(): Promise<FsWritableStream> {
    return Promise.resolve(new FakeWritable(this.file));
  }
}

class NotFound extends Error {
  name = "NotFoundError";
  constructor() {
    super("Not found");
  }
}

class FakeDirHandle implements FsDirHandle {
  readonly kind = "directory" as const;
  children = new Map<string, FakeFileHandle | FakeDirHandle>();
  constructor(public name: string) {}
  async *values(): AsyncIterable<FsFileHandle | FsDirHandle> {
    for (const child of this.children.values()) yield child;
  }
  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FsFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== "file") {
        throw new Error("Entry is a directory");
      }
      return existing;
    }
    if (options?.create) {
      const handle = new FakeFileHandle(
        name,
        new FakeFile(name, new Uint8Array(0)),
      );
      this.children.set(name, handle);
      return handle;
    }
    throw new NotFound();
  }
  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== "directory") {
        throw new Error("Entry is a file");
      }
      return existing;
    }
    if (options?.create) {
      const handle = new FakeDirHandle(name);
      this.children.set(name, handle);
      return handle;
    }
    throw new NotFound();
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw new NotFound();
    this.children.delete(name);
  }
}

const stringToBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

function newSpace() {
  return new FileSystemAccessSpacePrimitives(new FakeDirHandle("root"));
}

test("fetchFileList is empty initially", async () => {
  const space = newSpace();
  expect(await space.fetchFileList()).toEqual([]);
});

test("write and read text roundtrip", async () => {
  const space = newSpace();
  const meta = await space.writeFile("test.txt", stringToBytes("Hello World"));
  expect(meta.name).toEqual("test.txt");
  expect(meta.contentType).toEqual("text/plain");
  expect(meta.size).toEqual(11);
  expect(meta.lastModified > 0).toBeTruthy();

  const { data, meta: readMeta } = await space.readFile("test.txt");
  expect(new TextDecoder().decode(data)).toEqual("Hello World");
  expect(readMeta.name).toEqual("test.txt");

  expect(await space.fetchFileList()).toEqual([meta]);
  await space.deleteFile("test.txt");
  expect(await space.fetchFileList()).toEqual([]);
});

test("write and read binary (5MB) with content integrity", async () => {
  const space = newSpace();
  const buf = new Uint8Array(5 * 1024 * 1024);
  for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
  const meta = await space.writeFile("large.bin", buf);
  expect(meta.size).toEqual(buf.length);

  const { data } = await space.readFile("large.bin");
  expect(data.length).toEqual(buf.length);
  for (let i = 0; i < 1000; i++) expect(data[i]).toEqual(buf[i]);
  await space.deleteFile("large.bin");
});

test("subdirectory paths roundtrip and list", async () => {
  const space = newSpace();
  await space.writeFile("folder/page.md", stringToBytes("# Page"));
  await space.writeFile("a/b/c.txt", stringToBytes("nested"));

  const page = await space.readFile("folder/page.md");
  expect(new TextDecoder().decode(page.data)).toEqual("# Page");

  const nested = await space.readFile("a/b/c.txt");
  expect(new TextDecoder().decode(nested.data)).toEqual("nested");

  const list = await space.fetchFileList();
  expect(list.map((m) => m.name).sort()).toEqual([
    "a/b/c.txt",
    "folder/page.md",
  ]);

  await space.deleteFile("folder/page.md");
  expect((await space.fetchFileList()).map((m) => m.name)).toEqual([
    "a/b/c.txt",
  ]);
  await space.deleteFile("a/b/c.txt");
  expect(await space.fetchFileList()).toEqual([]);
});

test("overwrite keeps single entry and updates content", async () => {
  const space = newSpace();
  await space.writeFile("overwrite.txt", stringToBytes("Original"));
  await space.writeFile("overwrite.txt", stringToBytes("Updated"));
  const { data } = await space.readFile("overwrite.txt");
  expect(new TextDecoder().decode(data)).toEqual("Updated");
  const files = (await space.fetchFileList()).filter(
    (f) => f.name === "overwrite.txt",
  );
  expect(files.length).toEqual(1);
  await space.deleteFile("overwrite.txt");
});

test("empty file", async () => {
  const space = newSpace();
  await space.writeFile("empty.txt", new Uint8Array(0));
  const { data, meta } = await space.readFile("empty.txt");
  expect(data.length).toEqual(0);
  expect(meta.size).toEqual(0);
  await space.deleteFile("empty.txt");
});

test("unicode content roundtrip", async () => {
  const space = newSpace();
  const content = "Hello 世界! 🌍 Здравствуй мир!";
  await space.writeFile("unicode.txt", stringToBytes(content));
  const { data } = await space.readFile("unicode.txt");
  expect(new TextDecoder().decode(data)).toEqual(content);
  await space.deleteFile("unicode.txt");
});

test("special file names", async () => {
  const space = newSpace();
  const names = [
    "file with spaces.txt",
    "file-with-hyphens.txt",
    "file_with_underscores.txt",
    "file.with.dots.txt",
    "UPPERCASE.TXT",
    "émojis🚀file.txt",
  ];
  for (const name of names) {
    await space.writeFile(name, stringToBytes(`Content of ${name}`));
    const { data } = await space.readFile(name);
    expect(new TextDecoder().decode(data)).toEqual(`Content of ${name}`);
  }
  const all = (await space.fetchFileList()).map((m) => m.name);
  for (const name of names) expect(all).toContain(name);
  for (const name of names) await space.deleteFile(name);
  expect(await space.fetchFileList()).toEqual([]);
});

test("error handling for nonexistent files", async () => {
  const space = newSpace();
  await expect(space.readFile("nope.txt")).rejects.toEqual(notFoundError);
  await expect(space.deleteFile("nope.txt")).rejects.toEqual(notFoundError);
  await expect(space.getFileMeta("nope.txt")).rejects.toEqual(notFoundError);
  await expect(space.readFile("missing/deep.txt")).rejects.toEqual(
    notFoundError,
  );
});

test("metadata is derived from the filesystem, not suggestedMeta", async () => {
  const space = newSpace();
  const content = stringToBytes("Hello meta!");
  const meta = await space.writeFile("meta-test.txt", content, {
    name: "meta-test.txt",
    perm: "rw",
    created: 1000000,
    contentType: "text/plain",
    lastModified: 2000000,
    size: content.length,
  });
  expect(meta.name).toEqual("meta-test.txt");
  expect(meta.size).toEqual(content.length);
  expect(meta.lastModified > 0).toBeTruthy();
  // FS Access API cannot set file mtime; the OS-controlled value wins.
  expect(meta.lastModified).not.toEqual(2000000);
  await space.deleteFile("meta-test.txt");
});
