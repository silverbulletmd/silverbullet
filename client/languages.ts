import { yaml as yamlLanguage } from "@codemirror/legacy-modes/mode/yaml";
import { type Language, StreamLanguage } from "@codemirror/language";
import { luaLanguage } from "./space_lua/parse.ts";

const yamlStreamLanguage = StreamLanguage.define(yamlLanguage);

const eagerLanguages: Record<string, Language> = {
  meta: yamlStreamLanguage,
  yaml: yamlStreamLanguage,
  include: yamlStreamLanguage,
  "space-config": yamlStreamLanguage,
  data: yamlStreamLanguage,
  toc: yamlStreamLanguage,
  "space-lua": luaLanguage,
  lua: luaLanguage,
};

// Each entry is a lazy loader. import() is cached by the JS runtime,
// so aliases sharing a module (e.g. c/cpp/java from clike) don't re-fetch.
export const lazyLanguages: Record<string, () => Promise<Language>> = {
  javascript: async () =>
    (await import("@codemirror/lang-javascript")).javascriptLanguage,
  "space-script": async () =>
    (await import("@codemirror/lang-javascript")).javascriptLanguage,
  js: async () =>
    (await import("@codemirror/lang-javascript")).javascriptLanguage,
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).typescriptLanguage,
  ts: async () =>
    (await import("@codemirror/lang-javascript")).typescriptLanguage,
  json: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/javascript")).json,
    ),
  sql: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/sql")).standardSQL,
    ),
  postgresql: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/sql")).pgSQL,
    ),
  pgsql: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/sql")).pgSQL,
    ),
  postgres: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/sql")).pgSQL,
    ),
  css: async () => (await import("@codemirror/lang-css")).cssLanguage,
  "space-style": async () =>
    (await import("@codemirror/lang-css")).cssLanguage,
  html: async () => (await import("@codemirror/lang-html")).htmlLanguage,
  nix: async () =>
    (await import("@replit/codemirror-lang-nix")).nixLanguage,
  python: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/python")).python,
    ),
  py: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/python")).python,
    ),
  rust: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/rust")).rust,
    ),
  rs: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/rust")).rust,
    ),
  r: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/r")).r,
    ),
  shell: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/shell")).shell,
    ),
  sh: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/shell")).shell,
    ),
  bash: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/shell")).shell,
    ),
  zsh: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/shell")).shell,
    ),
  fish: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/shell")).shell,
    ),
  go: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/go")).go,
    ),
  golang: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/go")).go,
    ),
  xml: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/xml")).xml,
    ),
  swift: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/swift")).swift,
    ),
  toml: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/toml")).toml,
    ),
  protobuf: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf,
    ),
  proto: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf,
    ),
  diff: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/diff")).diff,
    ),
  powershell: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/powershell")).powerShell,
    ),
  perl: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/perl")).perl,
    ),
  ruby: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/ruby")).ruby,
    ),
  tcl: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/tcl")).tcl,
    ),
  verilog: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/verilog")).verilog,
    ),
  vhdl: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/vhdl")).vhdl,
    ),
  dockerfile: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile,
    ),
  cmake: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/cmake")).cmake,
    ),
  erlang: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/erlang")).erlang,
    ),
  c: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).c,
    ),
  cpp: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).cpp,
    ),
  "c++": async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).cpp,
    ),
  cxx: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).cpp,
    ),
  java: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).java,
    ),
  csharp: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).csharp,
    ),
  cs: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).csharp,
    ),
  "c#": async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).csharp,
    ),
  scala: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).scala,
    ),
  kotlin: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).kotlin,
    ),
  objc: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveC,
    ),
  "objective-c": async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveC,
    ),
  objectivec: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveC,
    ),
  objcpp: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveCpp,
    ),
  "objective-cpp": async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveCpp,
    ),
  objectivecpp: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveCpp,
    ),
  "objective-c++": async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveCpp,
    ),
  "objectivec++": async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).objectiveCpp,
    ),
  dart: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/clike")).dart,
    ),
};

const cache: Record<string, Language> = {};

export function languageFor(name: string): Language | null {
  return eagerLanguages[name] ?? cache[name] ??
    (name.startsWith("#") ? yamlStreamLanguage : null);
}

export async function loadLanguageFor(
  name: string,
): Promise<Language | null> {
  const eager = eagerLanguages[name];
  if (eager) return eager;
  if (name.startsWith("#")) return yamlStreamLanguage;
  if (cache[name]) return cache[name];
  const loader = lazyLanguages[name];
  if (!loader) return null;
  cache[name] = await loader();
  return cache[name];
}

export const allLanguageNames = [
  ...new Set([
    ...Object.keys(eagerLanguages),
    ...Object.keys(lazyLanguages),
  ]),
];
