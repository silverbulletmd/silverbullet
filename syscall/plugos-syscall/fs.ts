import { syscall } from "./syscall.ts";

export type FileMeta = {
  name: string;
  lastModified: number;
};

export function readFile(
  path: string,
  encoding: "utf8" | "dataurl" = "utf8",
): Promise<{ text: string; meta: FileMeta }> {
  return syscall("fs.readFile", path, encoding);
}

export function getFileMeta(path: string): Promise<FileMeta> {
  return syscall("fs.getFileMeta", path);
}

export function writeFile(
  path: string,
  text: string,
  encoding: "utf8" | "dataurl" = "utf8",
): Promise<FileMeta> {
  return syscall("fs.writeFile", path, text, encoding);
}

export function deleteFile(path: string): Promise<void> {
  return syscall("fs.deleteFile", path);
}

export function listFiles(
  dirName: string,
  recursive = false,
): Promise<FileMeta[]> {
  return syscall("fs.listFiles", dirName, recursive);
}
