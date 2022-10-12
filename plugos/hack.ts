export function patchDenoLibJS(code: string): string {
  // The Deno std lib has one occurence of a regex that Webkit JS doesn't (yet parse), we'll strip it because it's likely never invoked anyway, YOLO
  return code.replaceAll("/(?<=\\n)/", "/()/");
}
