import { LRLanguage } from "@codemirror/language";
import { yaml as yamlLanguage } from "@codemirror/legacy-modes/mode/yaml?external=@codemirror/language&target=es2022";
import {
  pgSQL as postgresqlLanguage,
  standardSQL as sqlLanguage,
} from "@codemirror/legacy-modes/mode/sql?external=@codemirror/language&target=es2022";
import { rust as rustLanguage } from "@codemirror/legacy-modes/mode/rust?external=@codemirror/language&target=es2022";
import { python as pythonLanguage } from "@codemirror/legacy-modes/mode/python?external=@codemirror/language&target=es2022";
import { protobuf as protobufLanguage } from "@codemirror/legacy-modes/mode/protobuf?external=@codemirror/language&target=es2022";
import { shell as shellLanguage } from "@codemirror/legacy-modes/mode/shell?external=@codemirror/language&target=es2022";
import { toml as tomlLanguage } from "@codemirror/legacy-modes/mode/toml?external=@codemirror/language&target=es2022";
import { xml as xmlLanguage } from "@codemirror/legacy-modes/mode/xml?external=@codemirror/language&target=es2022";
import { json as jsonLanguage } from "@codemirror/legacy-modes/mode/javascript?external=@codemirror/language&target=es2022";
import { htmlLanguage } from "@codemirror/lang-html";
import { go as goLanguage } from "@codemirror/legacy-modes/mode/go?external=@codemirror/language&target=es2022";
import { diff as diffLanguage } from "@codemirror/legacy-modes/mode/diff?external=@codemirror/language&target=es2022";
import { powerShell as powerShellLanguage } from "@codemirror/legacy-modes/mode/powershell?external=@codemirror/language&target=es2022";
import { perl as perlLanguage } from "@codemirror/legacy-modes/mode/perl?external=@codemirror/language&target=es2022";
import { tcl as tclLanguage } from "@codemirror/legacy-modes/mode/tcl?external=@codemirror/language&target=es2022";
import { verilog as verilogLanguage } from "@codemirror/legacy-modes/mode/verilog?external=@codemirror/language&target=es2022";
import { vhdl as vhdlLanguage } from "@codemirror/legacy-modes/mode/vhdl?external=@codemirror/language&target=es2022";
import { dockerFile as dockerfileLanguage } from "@codemirror/legacy-modes/mode/dockerfile?external=@codemirror/language&target=es2022";
import { cmake as cmakeLanguage } from "@codemirror/legacy-modes/mode/cmake?external=@codemirror/language&target=es2022";
import {
  c as cLanguage,
  cpp as cppLanguage,
  csharp as csharpLanguage,
  dart as dartLanguage,
  java as javaLanguage,
  kotlin as kotlinLanguage,
  objectiveC as objectiveCLanguage,
  objectiveCpp as objectiveCppLanguage,
  scala as scalaLanguage,
} from "@codemirror/legacy-modes/mode/clike?external=@codemirror/language&target=es2022";
import { Language, StreamLanguage } from "@codemirror/language";
import {
  javascriptLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import {
  extendedMarkdownLanguage,
  highlightingExpressionParser,
  highlightingQueryParser,
} from "./markdown_parser/parser.ts";
import { cssLanguage } from "@codemirror/lang-css";

export const builtinLanguages: Record<string, Language> = {
  "meta": StreamLanguage.define(yamlLanguage),
  "yaml": StreamLanguage.define(yamlLanguage),
  "include": StreamLanguage.define(yamlLanguage),
  "embed": StreamLanguage.define(yamlLanguage),
  "data": StreamLanguage.define(yamlLanguage),
  "toc": StreamLanguage.define(yamlLanguage),
  "javascript": javascriptLanguage,
  "space-script": javascriptLanguage,
  "js": javascriptLanguage,
  "typescript": typescriptLanguage,
  "ts": typescriptLanguage,
  "sql": StreamLanguage.define(sqlLanguage),
  "postgresql": StreamLanguage.define(postgresqlLanguage),
  "pgsql": StreamLanguage.define(postgresqlLanguage),
  "postgres": StreamLanguage.define(postgresqlLanguage),
  "rust": StreamLanguage.define(rustLanguage),
  "rs": StreamLanguage.define(rustLanguage),
  "css": cssLanguage,
  "space-style": cssLanguage,
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
  "go": StreamLanguage.define(goLanguage),
  "golang": StreamLanguage.define(goLanguage),
  "diff": StreamLanguage.define(diffLanguage),
  "powershell": StreamLanguage.define(powerShellLanguage),
  "perl": StreamLanguage.define(perlLanguage),
  "tcl": StreamLanguage.define(tclLanguage),
  "verilog": StreamLanguage.define(verilogLanguage),
  "vhdl": StreamLanguage.define(vhdlLanguage),
  "dockerfile": StreamLanguage.define(dockerfileLanguage),
  "cmake": StreamLanguage.define(cmakeLanguage),
  "query": LRLanguage.define({
    name: "query",
    parser: highlightingQueryParser,
  }),
  "template": extendedMarkdownLanguage,
  "expression": LRLanguage.define({
    name: "expression",
    parser: highlightingExpressionParser,
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
