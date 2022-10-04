import { syscall } from "./syscall.ts";

export type FileMeta = {
  name: string;
  lastModified: number;
};

export async function readFile(
  path: string,
  encoding: "utf8" | "dataurl" = "utf8"
): Promise<{ text: string; meta: FileMeta }> {
  return syscall("fs.readFile", path, encoding);
}

export async function getFileMeta(path: string): Promise<FileMeta> {
  return syscall("fs.getFileMeta", path);
}

export async function writeFile(
  path: string,
  text: string,
  encoding: "utf8" | "dataurl" = "utf8"
): Promise<FileMeta> {
  return syscall("fs.writeFile", path, text, encoding);
}

export async function deleteFile(path: string): Promise<void> {
  return syscall("fs.deleteFile", path);
}

export async function listFiles(
  dirName: string,
  recursive = false
): Promise<FileMeta[]> {
  return syscall("fs.listFiles", dirName, recursive);
}
