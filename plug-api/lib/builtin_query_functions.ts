import type { FunctionMap } from "$sb/types.ts";
import { niceDate } from "$sb/lib/dates.ts";

export const builtinFunctions: FunctionMap = {
  today() {
    return niceDate(new Date());
  },
  max(...args: number[]) {
    return Math.max(...args);
  },
  min(...args: number[]) {
    return Math.min(...args);
  },
  toJSON(obj: any) {
    return JSON.stringify(obj);
  },
  startsWith(str: string, prefix: string) {
    return str.startsWith(prefix);
  },
  endsWith(str: string, suffix: string) {
    return str.endsWith(suffix);
  },
  // Note: these assume Monday as the first day of the week
  firstDayOfWeek(dateString: string): string {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    const daysToSubtract = (dayOfWeek + 7 - 1) % 7;
    const firstDayOfWeek = new Date(date);
    firstDayOfWeek.setDate(date.getDate() - daysToSubtract);
    return niceDate(firstDayOfWeek);
  },
  lastDayOfWeek(dateString: string): string {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    const daysToAdd = (7 - dayOfWeek) % 7;
    const lastDayOfWeek = new Date(date);
    lastDayOfWeek.setDate(date.getDate() + daysToAdd);
    return niceDate(lastDayOfWeek);
  },
  addDays(dateString: string, daysToAdd: number): string {
    const date = new Date(dateString);
    date.setDate(date.getDate() + daysToAdd);
    return niceDate(date);
  },
};
