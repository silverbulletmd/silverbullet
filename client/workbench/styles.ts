import type { StyleRecord } from "../space_style.ts";
import type { Action } from "./action.ts";

/**
 * `empty`: the block holds CSS, yet the browser parsed no rules from it. The
 * browser drops invalid CSS without a word, so that is almost always a syntax
 * error. (A block that is only comments is fine.)
 */
export type StyleStatus = "applied" | "empty";

const COMMENTS = /\/\*[\s\S]*?\*\//g;

export function styleStatus(r: StyleRecord): StyleStatus {
  return r.rules === 0 && r.source.replace(COMMENTS, "").trim() !== ""
    ? "empty"
    : "applied";
}

/** What a style row's actions act through. */
export type StyleActionDeps = {
  openSource: (ref: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
};

/** What a style row's ⋯ menu offers. */
export function styleActions(r: StyleRecord): Action<StyleActionDeps>[] {
  return [
    {
      label: "Open source",
      icon: "definition",
      run: (deps) => deps.openSource(r.ref),
    },
    { label: "Copy CSS", icon: "copy", run: (deps) => deps.copyText(r.source) },
  ];
}
