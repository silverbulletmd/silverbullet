import type { FunctionMap } from "../type/types.ts";
import { niceDate, niceTime } from "./dates.ts";

export const builtinFunctions: FunctionMap = {
  today() {
    return niceDate(new Date());
  },
  replace(
    str: string,
    ...replacementPairs: any[]
  ) {
    if (replacementPairs.length % 2 !== 0) {
      throw new Error(
        "replace() requires an even number of replacement arguments",
      );
    }
    for (let i = 0; i < replacementPairs.length; i += 2) {
      const match = replacementPairs[i];
      const replace = replacementPairs[i + 1];
      const matcher = Array.isArray(match)
        ? new RegExp(match[0], match[1] + "g")
        : match;
      str = str.replaceAll(matcher, replace);
    }
    return str;
  },
  json: (v: any) => {
    return JSON.stringify(v);
  },
  niceDate: (ts: any) => niceDate(new Date(ts)),
  escapeRegexp: (ts: any) => {
    return ts.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  },
  // Legacy name: don't use
  escape: (handlebarsExpr: string) => {
    return `{{${handlebarsExpr}}}`;
  },
  escapeDirective: (directiveText: string) => {
    return `{{${directiveText}}}`;
  },
  time: () => niceTime(new Date()),
  tomorrow: () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return niceDate(tomorrow);
  },
  yesterday: () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return niceDate(yesterday);
  },
  lastWeek: () => {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    return niceDate(lastWeek);
  },
  nextWeek: () => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return niceDate(nextWeek);
  },
  weekStart: (startOnMonday = true) => {
    const d = new Date();
    const day = d.getDay();
    let diff = d.getDate() - day;
    if (startOnMonday) {
      diff += day == 0 ? -6 : 1;
    }
    return niceDate(new Date(d.setDate(diff)));
  },

  // List functions
  count: (list: any[]) => {
    return list.length;
  },
  at: (list: any[], index: number) => {
    return list[index];
  },
};
