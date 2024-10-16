import { assertEquals } from "@std/assert";
import { insertPlugIntoPage } from "./plugmanager.ts";

/** Convenience function simulating repeatedly calling `editor.replaceRange` */
function replaceRanges(
  pageText: string,
  ranges: Array<{ from: number; to: number; text: string }>,
): string {
  let result = pageText;
  for (const { from, to, text } of ranges) {
    result = result.substring(0, from) + text + result.substring(to);
  }
  return result;
}

Deno.test("Append plug to page", () => {
});
