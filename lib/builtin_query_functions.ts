import type { FunctionMap } from "../type/types.ts";
import { niceDate, niceTime } from "./dates.ts";

export const builtinFunctions: FunctionMap = {
  today() {
    return niceDate(new Date());
  },
  replace(
    str: string,
    match: [string, string] | string,
    replace: string,
  ) {
    const matcher = Array.isArray(match)
      ? new RegExp(match[0], match[1] + "g")
      : match;
    return str.replaceAll(matcher, replace);
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
