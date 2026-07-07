import type {
  FsDirHandle,
  FsFile,
  FsFileHandle,
  FsWritableStream,
} from "./fs_access_space_primitives.ts";

// An in-memory implementation of the FsDirHandle / FsFileHandle / FsFile
// protocol the real File System Access API exposes. The subset is small enough
// that this fake is structurally faithful — it's used both to unit-test
// FileSystemAccessSpacePrimitives directly and to drive LocalFolderSync against
// a "real" FSA adapter in integration tests.

export class FakeFile {
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

export class FakeWritable implements FsWritableStream {
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

export class FakeFileHandle implements FsFileHandle {
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

export class NotFoundError extends Error {
  name = "NotFoundError";
  constructor() {
    super("Not found");
  }
}

export class FakeDirHandle implements FsDirHandle {
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
    throw new NotFoundError();
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
    throw new NotFoundError();
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw new NotFoundError();
    this.children.delete(name);
  }
}

export const stringToBytes = (s: string): Uint8Array =>
  new TextEncoder().encode(s);
