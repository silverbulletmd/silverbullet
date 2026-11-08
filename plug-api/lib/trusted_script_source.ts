import { getNameFromPath, parseToRef } from "./ref.ts";

export function isTrustedScriptPage(name: string): boolean {
  if (!isCanonicalSpacePath(name)) return false;
  return name === "CONFIG" || name.startsWith("Library/");
}

function isCanonicalSpacePath(path: string): boolean {
  return (
    path.length > 0 &&
    !/[\\%:]/.test(path) &&
    !path.includes(String.fromCharCode(0)) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function assertEditorWritePath(...paths: string[]): void {
  for (const path of paths) {
    if (!isCanonicalSpacePath(path)) throw new Error("Invalid write path");
    const folded = path.toLowerCase();
    if (
      folded === "config.md" ||
      folded === "library" ||
      folded.startsWith("library/")
    ) {
      throw new Error("Builder permission required");
    }
  }
}

export function isTrustedScriptObject(
  object: { tag: string; ref: string },
  tag: "space-lua" | "space-style",
): boolean {
  if (object.tag !== tag) return false;
  const ref = parseToRef(object.ref);
  return (
    ref?.details?.type === "position" &&
    isTrustedScriptPage(getNameFromPath(ref.path))
  );
}
