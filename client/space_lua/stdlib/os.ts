import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";

const ONE_DAY = 1000 * 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

function weekNumber(
  d: Date,
  utc: boolean,
  weekStartDay: number,
  iso: boolean,
): number {
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const date = new Date(Date.UTC(year, month, day));

  if (iso) {
    const target = new Date(date);
    target.setUTCDate(
      target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7),
    );

    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const weekStart = new Date(yearStart);
    weekStart.setUTCDate(
      yearStart.getUTCDate() - ((yearStart.getUTCDay() + 6) % 7),
    );

    return 1 + Math.floor((target.getTime() - weekStart.getTime()) / ONE_WEEK);
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const startDay = yearStart.getUTCDay();
  const offset = (7 + (startDay - weekStartDay)) % 7;
  const firstWeekStart = new Date(yearStart);

  firstWeekStart.setUTCDate(yearStart.getUTCDate() + (7 - offset) % 7);

  if (date < firstWeekStart) return 0;
  return 1 +
    Math.floor((date.getTime() - firstWeekStart.getTime()) / ONE_WEEK);
}

function dayOfYear(d: Date, utc: boolean): number {
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  const start = new Date(Date.UTC(year, 0, 0));

  const current = utc
    ? new Date(
      Date.UTC(
        year,
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
      ),
    )
    : new Date(
      Date.UTC(
        year,
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
      ),
    );

  return Math.floor((current.getTime() - start.getTime()) / ONE_DAY);
}

function isoWeekYear(d: Date, utc: boolean): number {
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const target = new Date(Date.UTC(year, month, day));

  target.setUTCDate(
    target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7),
  );

  return target.getUTCFullYear();
}

function isDST(d: Date): boolean {
  const jan = new Date(d.getFullYear(), 0, 1);

  return d.getTimezoneOffset() < jan.getTimezoneOffset();
}

function yr(d: Date, utc: boolean): number {
  return utc ? d.getUTCFullYear() : d.getFullYear();
}

function mo(d: Date, utc: boolean): number {
  return utc ? d.getUTCMonth() : d.getMonth();
}

function da(d: Date, utc: boolean): number {
  return utc ? d.getUTCDate() : d.getDate();
}

function hr(d: Date, utc: boolean): number {
  return utc ? d.getUTCHours() : d.getHours();
}

function mi(d: Date, utc: boolean): number {
  return utc ? d.getUTCMinutes() : d.getMinutes();
}

function sc(d: Date, utc: boolean): number {
  return utc ? d.getUTCSeconds() : d.getSeconds();
}

function wd(d: Date, utc: boolean): number {
  return utc ? d.getUTCDay() : d.getDay();
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function dateTable(d: Date, utc: boolean): LuaTable {
  const tbl = new LuaTable({
    year: yr(d, utc),
    month: mo(d, utc) + 1,
    day: da(d, utc),
    hour: hr(d, utc),
    min: mi(d, utc),
    sec: sc(d, utc),
    wday: wd(d, utc) + 1,
    yday: dayOfYear(d, utc),
  });

  if (!utc) {
    tbl.rawSet("isdst", isDST(d));
  }

  return tbl;
}

// Build the specifier map for a given `Date` and `utc` flag.
// Returns a record mapping single-char specifier to its output string.
function buildSpecMap(
  d: Date,
  utc: boolean,
): Record<string, () => string> {
  const h = () => hr(d, utc);
  const h12 = () => h() % 12 || 12;
  const dow = () => wd(d, utc);

  return {
    // Date
    "Y": () => yr(d, utc).toString(),
    "y": () => pad2(yr(d, utc) % 100),
    "C": () => pad2(Math.floor(yr(d, utc) / 100)),
    "m": () => pad2(mo(d, utc) + 1),
    "d": () => pad2(da(d, utc)),
    "e": () => da(d, utc).toString().padStart(2, " "),
    "j": () => pad3(dayOfYear(d, utc)),

    // Time
    "H": () => pad2(h()),
    "I": () => pad2(h12()),
    "M": () => pad2(mi(d, utc)),
    "S": () => pad2(sc(d, utc)),
    "p": () => h() >= 12 ? "PM" : "AM",

    // Weekday
    "A": () =>
      d.toLocaleString("en-US", {
        weekday: "long",
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "a": () =>
      d.toLocaleString("en-US", {
        weekday: "short",
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "w": () => dow().toString(),
    "u": () => (dow() === 0 ? 7 : dow()).toString(),

    // Month name
    "b": () =>
      d.toLocaleString("en-US", {
        month: "short",
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "h": () =>
      d.toLocaleString("en-US", {
        month: "short",
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "B": () =>
      d.toLocaleString("en-US", {
        month: "long",
        ...(utc ? { timeZone: "UTC" } : {}),
      }),

    // Week number
    "U": () => pad2(weekNumber(d, utc, 0, false)),
    "W": () => pad2(weekNumber(d, utc, 1, false)),
    "V": () => pad2(weekNumber(d, utc, 1, true)),
    "G": () => isoWeekYear(d, utc).toString(),
    "g": () => pad2(isoWeekYear(d, utc) % 100),

    // Composite specifiers
    "c": () =>
      d.toLocaleString("en-US", {
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "x": () =>
      d.toLocaleDateString("en-US", {
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "X": () =>
      d.toLocaleTimeString("en-US", {
        ...(utc ? { timeZone: "UTC" } : {}),
      }),
    "D": () =>
      `${pad2(mo(d, utc) + 1)}/${pad2(da(d, utc))}/${pad2(yr(d, utc) % 100)}`,
    "F": () =>
      `${yr(d, utc).toString()}-${pad2(mo(d, utc) + 1)}-${pad2(da(d, utc))}`,
    "R": () => `${pad2(h())}:${pad2(mi(d, utc))}`,
    "T": () => `${pad2(h())}:${pad2(mi(d, utc))}:${pad2(sc(d, utc))}`,
    "r": () =>
      `${pad2(h12())}:${pad2(mi(d, utc))}:${pad2(sc(d, utc))} ${
        h() >= 12 ? "PM" : "AM"
      }`,

    // Epoch
    "s": () => Math.floor(d.getTime() / 1000).toString(),

    // Whitespace
    "n": () => "\n",
    "t": () => "\t",

    // Timezone
    "Z": () => {
      if (utc) return "UTC";
      const match = d.toTimeString().match(/\((.*)\)/);
      return match ? match[1] : "";
    },
    "z": () => {
      if (utc) return "+0000";
      const offset = -d.getTimezoneOffset();
      const sign = offset >= 0 ? "+" : "-";
      const abs = Math.abs(offset);
      return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
    },

    // Literal
    "%": () => "%",
  };
}

function luaFormatTime(fmt: string, d: Date, utc: boolean): string {
  const specs = buildSpecMap(d, utc);

  let out = "";
  let i = 0;

  while (i < fmt.length) {
    if (fmt[i] !== "%") {
      out += fmt[i];
      i++;
      continue;
    }
    i++; // skip '%'
    if (i >= fmt.length) {
      throw new Error("invalid conversion specifier '%'");
    }

    const ch = fmt[i];
    const fn = specs[ch];
    if (!fn) {
      throw new Error(`invalid conversion specifier '%${ch}'`);
    }

    out += fn();
    i++;
  }

  return out;
}

export const osApi = new LuaTable({
  time: new LuaBuiltinFunction((_sf, tbl?: LuaTable) => {
    if (tbl) {
      if (!tbl.has("year")) {
        throw new Error("time(): year is required");
      }

      if (!tbl.has("month")) {
        throw new Error("time(): month is required");
      }

      if (!tbl.has("day")) {
        throw new Error("time(): day is required");
      }

      const year = tbl.get("year");
      const month = tbl.get("month");
      const day = tbl.get("day");
      const hour = tbl.get("hour") ?? 12;
      const min = tbl.get("min") ?? 0;
      const sec = tbl.get("sec") ?? 0;
      const date = new Date(year, month - 1, day, hour, min, sec);

      return Math.floor(date.getTime() / 1000);
    }

    return Math.floor(Date.now() / 1000);
  }),

  // Returns the difference, from time `t1` to time `t2` in seconds
  // In POSIX and some other systems, this value is exactly $t2-t1$.
  difftime: new LuaBuiltinFunction((_sf, t2: number, t1: number): number => {
    return t2 - t1;
  }),

  // Returns a string or a table containing date and time, formatted
  // according to the given string format.
  //
  // If format starts with '!', the date is formatted in UTC.
  //
  // If format is "*t" (or "!*t"), returns a table with fields:
  //
  // - `year`,
  // - `month` (1-12),
  // - `day` (1-31),
  // - `hour` (0-23),
  // - `min` (0-59),
  // - `sec` (0-61),
  // - `wday` (1-7, Sunday is 1),
  // - `yday` (1-366), and
  // - `isdst` (boolean).
  //
  // Otherwise, format specifiers follow ISO C `strftime`.
  //
  // If format is absent, it defaults to `%c`.
  date: new LuaBuiltinFunction(
    (_sf, format?: string, timestamp?: number) => {
      let fmt = format ?? "%c";
      let utc = false;

      if (fmt.startsWith("!")) {
        utc = true;
        fmt = fmt.slice(1);
      }

      const d = timestamp !== undefined && timestamp !== null
        ? new Date(timestamp * 1000)
        : new Date();

      if (fmt === "*t") {
        return dateTable(d, utc);
      }

      return luaFormatTime(fmt, d, utc);
    },
  ),

  // Returns an approximation of CPU time used by the program in seconds.
  clock: new LuaBuiltinFunction((_sf): number => {
    return performance.now() / 1000.0;
  }),
});
