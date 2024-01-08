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
import {
  expressionParser,
  highlightingQueryParser,
} from "./markdown_parser/parser.ts";

export const builtinLanguages: Record<string, Language> = {
  "meta": StreamLanguage.define(yamlLanguage),
  "yaml": StreamLanguage.define(yamlLanguage),
  "template": StreamLanguage.define(yamlLanguage),
  "embed": StreamLanguage.define(yamlLanguage),
  "data": StreamLanguage.define(yamlLanguage),
  "toc": StreamLanguage.define(yamlLanguage),
  "javascript": javascriptLanguage,
  "js": javascriptLanguage,
  "typescript": typescriptLanguage,
  "ts": typescriptLanguage,
  "sql": StreamLanguage.define(sqlLanguage),
  "postgresql": StreamLanguage.define(postgresqlLanguage),
  "pgsql": StreamLanguage.define(postgresqlLanguage),
  "postgres": StreamLanguage.define(postgresqlLanguage),
  "rust": StreamLanguage.define(rustLanguage),
  "rs": StreamLanguage.define(rustLanguage),
  "css": StreamLanguage.define(sqlLanguage),
  "html": htmlLanguage,
  "python": StreamLanguage.define(pythonLanguage),
  "py": StreamLanguage.define(pythonLanguage),
  "protobuf": StreamLanguage.define(protobufLanguage),
  "proto": StreamLanguage.define(protobufLanguage),
  "shell": StreamLanguage.define(shellLanguage),
  "sh": StreamLanguage.define(shellLanguage),
  "bash": StreamLanguage.define(shellLanguage),
  "zsh": StreamLanguage.define(shellLanguage),
  "fish": StreamLanguage.define(shellLanguage),
  "swift": StreamLanguage.define(rustLanguage),
  "toml": StreamLanguage.define(tomlLanguage),
  "json": StreamLanguage.define(jsonLanguage),
  "xml": StreamLanguage.define(xmlLanguage),
  "c": StreamLanguage.define(cLanguage),
  "cpp": StreamLanguage.define(cppLanguage),
  "c++": StreamLanguage.define(cppLanguage),
  "cxx": StreamLanguage.define(cppLanguage),
  "java": StreamLanguage.define(javaLanguage),
  "csharp": StreamLanguage.define(csharpLanguage),
  "cs": StreamLanguage.define(csharpLanguage),
  "c#": StreamLanguage.define(csharpLanguage),
  "scala": StreamLanguage.define(scalaLanguage),
  "kotlin": StreamLanguage.define(kotlinLanguage),
  "objc": StreamLanguage.define(objectiveCLanguage),
  "objective-c": StreamLanguage.define(objectiveCLanguage),
  "objectivec": StreamLanguage.define(objectiveCLanguage),
  "objcpp": StreamLanguage.define(objectiveCppLanguage),
  "objective-cpp": StreamLanguage.define(objectiveCppLanguage),
  "objectivecpp": StreamLanguage.define(objectiveCppLanguage),
  "objective-c++": StreamLanguage.define(objectiveCppLanguage),
  "objectivec++": StreamLanguage.define(objectiveCppLanguage),
  "dart": StreamLanguage.define(dartLanguage),
  "query": LRLanguage.define({
    name: "query",
    parser: highlightingQueryParser,
  }),
  "expression": LRLanguage.define({
    name: "expression",
    parser: expressionParser,
  }),
};

export function languageFor(name: string): Language | null {
  if (builtinLanguages[name]) {
    return builtinLanguages[name];
  }
  if (name.startsWith("#")) {
    return StreamLanguage.define(yamlLanguage);
  }
  return null;
}
