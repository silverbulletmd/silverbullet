import { syscall } from "../syscall.ts";
import type { ParseTree } from "../lib/tree.ts";

/**
 * Parses a piece of code using any of the supported SB languages, see `common/languages.ts` for a list
 * @param language the language to parse
 * @param code the code to parse
 * @returns a ParseTree representation of the code
 */
export function parseLanguage(
  language: string,
  code: string,
): Promise<ParseTree> {
  return syscall("language.parseLanguage", language, code);
}

export function listLanguages(): Promise<string[]> {
  return syscall("language.listLanguages");
}
