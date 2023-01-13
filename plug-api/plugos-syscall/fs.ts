import { syscall } from "./syscall.ts";
import type { FileMeta, ProxyFileSystem } from "./types.ts";

export class LocalFileSystem implements ProxyFileSystem {
  constructor(readonly root: string) {
  }

  readFile(
    path: string,
    encoding: "utf8" | "dataurl" = "utf8",
  ): Promise<string> {
    return syscall("fs.readFile", `${this.root}/${path}`, encoding);
  }

  async getFileMeta(path: string): Promise<FileMeta> {
    return this.removeRootDir(
      await syscall("fs.getFileMeta", `${this.root}/${path}`),
    );
  }

  writeFile(
    path: string,
    text: string,
    encoding: "utf8" | "dataurl" = "utf8",
  ): Promise<FileMeta> {
    return syscall("fs.writeFile", `${this.root}/${path}`, text, encoding);
  }

  deleteFile(path: string): Promise<void> {
    return syscall("fs.deleteFile", `${this.root}/${path}`);
  }

  async listFiles(
    dirName: string,
    recursive = false,
  ): Promise<FileMeta[]> {
    return (await syscall(
      "fs.listFiles",
      `${this.root}/${dirName}`,
      recursive,
    )).map(this.removeRootDir.bind(this));
  }

  private removeRootDir(fileMeta: FileMeta): FileMeta {
    fileMeta.name = fileMeta.name.substring(this.root.length + 1);
    return fileMeta;
  }
}
