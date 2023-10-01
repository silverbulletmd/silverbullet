import { LRLanguage } from "@codemirror/language";
import {
  cLanguage,
  cppLanguage,
  csharpLanguage,
  dartLanguage,
  htmlLanguage,
  javaLanguage,
  javascriptLanguage,
  jsonLanguage,
  kotlinLanguage,
  Language,
  objectiveCLanguage,
  objectiveCppLanguage,
  postgresqlLanguage,
  protobufLanguage,
  pythonLanguage,
  rustLanguage,
  scalaLanguage,
  shellLanguage,
  sqlLanguage,
  StreamLanguage,
  tomlLanguage,
  typescriptLanguage,
  xmlLanguage,
  yamlLanguage,
} from "./deps.ts";
import { highlightingDirectiveParser } from "./markdown_parser/parser.ts";

const languageCache = new Map<string, Language>();

export function languageFor(name: string): Language | null {
  if (languageCache.has(name)) {
    return languageCache.get(name)!;
  }
  const language = languageLookup(name);
  if (!language) {
    return null;
  }
  languageCache.set(name, language);
  return language;
}

function languageLookup(name: string): Language | null {
  switch (name) {
    case "meta":
    case "yaml":
    case "data":
      return StreamLanguage.define(yamlLanguage);

    case "javascript":
    case "js":
      return javascriptLanguage;
    case "typescript":
    case "ts":
      return typescriptLanguage;
    case "sql":
      return StreamLanguage.define(sqlLanguage);
    case "postgresql":
    case "pgsql":
    case "postgres":
      return StreamLanguage.define(postgresqlLanguage);
    case "rust":
    case "rs":
      return StreamLanguage.define(rustLanguage);
    case "css":
      return StreamLanguage.define(sqlLanguage);
    case "html":
      return htmlLanguage;
    case "python":
    case "py":
      return StreamLanguage.define(pythonLanguage);
    case "protobuf":
    case "proto":
      return StreamLanguage.define(protobufLanguage);
    case "shell":
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return StreamLanguage.define(shellLanguage);
    case "swift":
      return StreamLanguage.define(rustLanguage);
    case "toml":
      return StreamLanguage.define(tomlLanguage);
    case "json":
      return StreamLanguage.define(jsonLanguage);
    case "xml":
      return StreamLanguage.define(xmlLanguage);
    case "c":
      return StreamLanguage.define(cLanguage);
    case "cpp":
    case "c++":
    case "cxx":
      return StreamLanguage.define(cppLanguage);
    case "java":
      return StreamLanguage.define(javaLanguage);
    case "csharp":
    case "cs":
    case "c#":
      return StreamLanguage.define(csharpLanguage);
    case "scala":
      return StreamLanguage.define(scalaLanguage);
    case "kotlin":
      return StreamLanguage.define(kotlinLanguage);
    case "objc":
    case "objective-c":
    case "objectivec":
      return StreamLanguage.define(objectiveCLanguage);
    case "objcpp":
    case "objective-cpp":
    case "objectivecpp":
    case "objective-c++":
    case "objectivec++":
      return StreamLanguage.define(objectiveCppLanguage);

    case "dart":
      return StreamLanguage.define(dartLanguage);

    case "query":
      return LRLanguage.define({
        name: "query",
        parser: highlightingDirectiveParser,
      });

    default:
      if (name.startsWith("#")) {
        return StreamLanguage.define(yamlLanguage);
      }
  }
  return null;
}
