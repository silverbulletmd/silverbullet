import type { SysCallMapping } from "../system.ts";
import { parse } from "../../markdown_parser/parse_tree.ts";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import {
  allLanguageNames,
  languageFor,
  loadLanguageFor,
} from "../../languages.ts";

export function languageSyscalls(): SysCallMapping {
  return {
    "language.parseLanguage": {
      callback: async (
        _ctx,
        language: string,
        code: string,
      ): Promise<ParseTree> => {
        const lang = languageFor(language) ?? (await loadLanguageFor(language));
        if (!lang) {
          throw new Error(`Unknown language ${language}`);
        }
        return parse(lang, code);
      },
      description: "Parses code using a supported fenced-code-block language.",
      parameters: [
        {
          name: "language",
          type: "string",
          description: "Language name or alias.",
        },
        {
          name: "code",
          type: "string",
          description: "Source code to parse.",
        },
      ],
      returns: [{ type: "table", description: "Parsed syntax tree." }],
      examples: [
        {
          code: 'local tree = language.parseLanguage("javascript", "const answer = 42")',
        },
      ],
    },
    "language.listLanguages": {
      callback: (): string[] => {
        return allLanguageNames;
      },
      description: "Lists all supported fenced-code-block languages.",
      returns: [{ type: "table", description: "Supported language names." }],
      examples: [{ code: "local languages = language.listLanguages()" }],
    },
  };
}
