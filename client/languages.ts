import { yaml as yamlLanguage } from "@codemirror/legacy-modes/mode/yaml";
import {
  pgSQL as postgresqlLanguage,
  standardSQL as sqlLanguage,
} from "@codemirror/legacy-modes/mode/sql";
import { rust as rustLanguage } from "@codemirror/legacy-modes/mode/rust";
import { python as pythonLanguage } from "@codemirror/legacy-modes/mode/python";
import {
  protobuf as protobufLanguage,
} from "@codemirror/legacy-modes/mode/protobuf";
import { shell as shellLanguage } from "@codemirror/legacy-modes/mode/shell";
import { swift as swiftLanguage } from "@codemirror/legacy-modes/mode/swift";
import { toml as tomlLanguage } from "@codemirror/legacy-modes/mode/toml";
import { xml as xmlLanguage } from "@codemirror/legacy-modes/mode/xml";
import { json as jsonLanguage } from "@codemirror/legacy-modes/mode/javascript";
import { r as rLanguage } from "@codemirror/legacy-modes/mode/r";
import { htmlLanguage } from "@codemirror/lang-html";
import { go as goLanguage } from "@codemirror/legacy-modes/mode/go";
import { diff as diffLanguage } from "@codemirror/legacy-modes/mode/diff";
import {
  powerShell as powerShellLanguage,
} from "@codemirror/legacy-modes/mode/powershell";
import { perl as perlLanguage } from "@codemirror/legacy-modes/mode/perl";
import { ruby as rubyLanguage } from "@codemirror/legacy-modes/mode/ruby";
import { tcl as tclLanguage } from "@codemirror/legacy-modes/mode/tcl";
import {
  verilog as verilogLanguage,
} from "@codemirror/legacy-modes/mode/verilog";
import { vhdl as vhdlLanguage } from "@codemirror/legacy-modes/mode/vhdl";
import {
  dockerFile as dockerfileLanguage,
} from "@codemirror/legacy-modes/mode/dockerfile";
import { cmake as cmakeLanguage } from "@codemirror/legacy-modes/mode/cmake";
import { erlang as erlangLanguage } from "@codemirror/legacy-modes/mode/erlang";
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
} from "@codemirror/legacy-modes/mode/clike";
import { type Language, StreamLanguage } from "@codemirror/language";
import {
  javascriptLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { cssLanguage } from "@codemirror/lang-css";
import { nixLanguage } from "@replit/codemirror-lang-nix";
import { luaLanguage } from "../lib/space_lua/parse.ts";

const yamlStreamLanguage = StreamLanguage.define(yamlLanguage);

export const builtinLanguages: Record<string, Language> = {
  "meta": yamlStreamLanguage,
  "yaml": yamlStreamLanguage,
  "include": yamlStreamLanguage,
  "space-config": yamlStreamLanguage,
  "data": yamlStreamLanguage,
  "toc": yamlStreamLanguage,
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
  "r": StreamLanguage.define(rLanguage),
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
  "swift": StreamLanguage.define(swiftLanguage),
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
  "ruby": StreamLanguage.define(rubyLanguage),
  "tcl": StreamLanguage.define(tclLanguage),
  "verilog": StreamLanguage.define(verilogLanguage),
  "vhdl": StreamLanguage.define(vhdlLanguage),
  "dockerfile": StreamLanguage.define(dockerfileLanguage),
  "cmake": StreamLanguage.define(cmakeLanguage),
  "erlang": StreamLanguage.define(erlangLanguage),
  "nix": nixLanguage,
  "space-lua": luaLanguage,
  "lua": luaLanguage,
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
