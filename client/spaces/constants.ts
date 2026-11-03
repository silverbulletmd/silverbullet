export const stdLibPrefix = "Library/Std/";
export const fsEndpoint = "/.fs";

export function isStdLibFile(path: string): boolean {
  return path === "Library/Std.md" || path.startsWith(stdLibPrefix);
}
