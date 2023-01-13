export type FileMeta = {
  name: string;
  lastModified: number;
};

export interface ProxyFileSystem {
  readFile(
    path: string,
    encoding: "utf8" | "dataurl",
  ): Promise<string>;

  getFileMeta(path: string): Promise<FileMeta>;

  writeFile(
    path: string,
    text: string,
    encoding: "utf8" | "dataurl",
  ): Promise<FileMeta>;

  deleteFile(path: string): Promise<void>;

  listFiles(
    path: string,
  ): Promise<FileMeta[]>;
}
