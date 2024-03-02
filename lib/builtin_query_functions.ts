import type { FunctionMap } from "../plug-api/types.ts";
import { niceDate, niceTime } from "./dates.ts";

export const builtinFunctions: FunctionMap = {
  // String functions
  contains(str: unknown, substr: unknown) {
    if (typeof str !== "string") {
      throw new Error("contains(): str is not a string");
    }
    if (typeof substr !== "string") {
      throw new Error("contains(): substr is not a string");
    }
    return str.includes(substr);
  },
  replace(
    str: unknown,
    ...replacementPairs: unknown[]
  ) {
    if (typeof str !== "string") {
      throw new Error("replace(): str is not a string");
    }

    if (replacementPairs.length % 2 !== 0) {
      throw new Error(
        "replace(): requires an even number of replacement arguments",
      );
    }

    let ret = str;
    for (let i = 0; i < replacementPairs.length; i += 2) {
      let match = replacementPairs[i];
      const replace = replacementPairs[i + 1];
      match = Array.isArray(match)
        ? new RegExp(match[0], (match[1] ?? "") + "g")
        : match;

      if (typeof match !== "string" && (!(match instanceof RegExp))) {
        throw new Error(
          `replace(): match is not a string or regexp`,
        );
      }
      if (typeof replace !== "string") {
        throw new Error(
          `replace(): replace is not a string`,
        );
      }

      ret = ret.replaceAll(match, replace);
    }
    return ret;
  },
  json: (v: unknown) => {
    return JSON.stringify(v);
  },
  niceDate: (ts: unknown) => {
    if (
      typeof ts !== "string" && typeof ts !== "number" && !(ts instanceof Date)
    ) {
      throw new Error("niceDate(): ts is not a valid date");
    }

    const date = new Date(ts);
    if (isNaN(date.getTime())) {
      throw new Error("niceDate(): ts is not a valid date");
    }

    return niceDate(new Date(ts));
  },
  escapeRegexp: (ts: unknown) => {
    if (typeof ts !== "string") {
      throw new Error("escapeRegexp(): ts is not a string");
    }
    return ts.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  },
  // Legacy name: don't use
  escape: (handlebarsExpr: string) => {
    return `{{${handlebarsExpr}}}`;
  },
  escapeDirective: (directiveText: unknown) => {
    return `{{${directiveText}}}`;
  },
  today() {
    return niceDate(new Date());
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
  count: <T>(list: T[]) => {
    return list.length;
  },
  at: <T>(list: T[], index: number) => {
    return list[index];
  },
};
