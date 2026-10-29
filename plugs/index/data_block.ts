// Data block rules shared by the indexer and the editor's data block preview;
// keep this free of syscalls so the client can import it.
import { isBuiltinTag } from "@silverbulletmd/silverbullet/lib/tags";
import { isValidAnchorName } from "./anchor.ts";

/**
 * Whether a ```#name fence names a built-in tag other than `data`: its objects
 * would pass for real tasks, pages, … so such a block is not indexed (lint flags it)
 */
export function shadowsBuiltinTag(fenceType: string): boolean {
  return (
    fenceType.startsWith("#") &&
    fenceType !== "#data" &&
    isBuiltinTag(fenceType.slice(1))
  );
}

/**
 * The root tag of a fenced block's objects: "data" for ```data, the name for
 * ```#name, or undefined when the fence isn't an indexed data block
 */
export function dataBlockTag(fenceType: string): string | undefined {
  if (fenceType !== "data" && !fenceType.startsWith("#")) return undefined;
  if (shadowsBuiltinTag(fenceType)) return undefined;
  return fenceType === "data" ? "data" : fenceType.slice(1);
}

export function splitYamlDocuments(
  text: string,
): { text: string; offset: number }[] {
  const docs: { text: string; offset: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(/^---[ \t]*$/gm)) {
    docs.push({ text: text.slice(start, m.index), offset: start });
    start = m.index + m[0].length;
  }
  docs.push({ text: text.slice(start), offset: start });
  return docs;
}

/** A data object's ref: its `$ref` anchor when valid, else its position */
export function dataObjectRef(
  pageName: string,
  docStart: number,
  doc: unknown,
): string {
  const anchor =
    doc && typeof doc === "object"
      ? (doc as Record<string, unknown>).$ref
      : undefined;
  return typeof anchor === "string" && isValidAnchorName(anchor)
    ? anchor
    : `${pageName}@${docStart}`;
}
