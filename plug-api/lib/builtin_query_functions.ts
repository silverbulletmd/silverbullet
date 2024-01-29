import type { FunctionMap } from "$sb/types.ts";
import { niceDate, niceTime } from "$sb/lib/dates.ts";

export const builtinFunctions: FunctionMap = {
  today() {
    return niceDate(new Date());
  },
  max(_, ...args: number[]) {
    return Math.max(...args);
  },
  log(_, val) {
    console.log("Function log", val);
    return val;
  },
  min(_, ...args: number[]) {
    return Math.min(...args);
  },
  replace(
    _globals,
    str: string,
    match: [string, string] | string,
    replace: string,
  ) {
    const matcher = Array.isArray(match)
      ? new RegExp(match[0], match[1] + "g")
      : match;
    return str.replaceAll(matcher, replace);
  },
  toJSON(_globals, obj: any) {
    return JSON.stringify(obj);
  },
  startsWith(_globals, str: string, prefix: string) {
    return str.startsWith(prefix);
  },
  endsWith(_globals, str: string, suffix: string) {
    return str.endsWith(suffix);
  },
  // Note: these assume Monday as the first day of the week
  firstDayOfWeek(_globals, dateString: string): string {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    const daysToSubtract = (dayOfWeek + 7 - 1) % 7;
    const firstDayOfWeek = new Date(date);
    firstDayOfWeek.setDate(date.getDate() - daysToSubtract);
    return niceDate(firstDayOfWeek);
  },
  lastDayOfWeek(_globals, dateString: string): string {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    const daysToAdd = (7 - dayOfWeek) % 7;
    const lastDayOfWeek = new Date(date);
    lastDayOfWeek.setDate(date.getDate() + daysToAdd);
    return niceDate(lastDayOfWeek);
  },
  addDays(_globals, dateString: string, daysToAdd: number): string {
    const date = new Date(dateString);
    date.setDate(date.getDate() + daysToAdd);
    return niceDate(date);
  },

  json: (v: any) => JSON.stringify(v),
  niceDate: (ts: any) => niceDate(new Date(ts)),
  escapeRegexp: (ts: any) => {
    return ts.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  },
  escape: (_, handlebarsExpr: string) => {
    return `{{${handlebarsExpr}}}`;
  },
  replaceRegexp: (_, s: string, regexp: string, replacement: string) => {
    return s.replace(new RegExp(regexp, "g"), replacement);
  },
  prefixLines: (_, v: string, prefix: string) =>
    v.split("\n").map((l) => prefix + l).join("\n"),
  substring: (_, s: string, from: number, to: number, elipsis = "") =>
    s.length > to - from ? s.substring(from, to) + elipsis : s,

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
  weekStart: (_, startOnMonday = true) => {
    const d = new Date();
    const day = d.getDay();
    let diff = d.getDate() - day;
    if (startOnMonday) {
      diff += day == 0 ? -6 : 1;
    }
    return niceDate(new Date(d.setDate(diff)));
  },
};
