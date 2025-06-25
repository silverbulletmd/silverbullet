import { LuaBuiltinFunction, LuaTable } from "../runtime.ts";

const ONE_DAY = 1000 * 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

// weekStartDay: 0 for Sunday, 1 for Monday
// iso: if true, week 01 contains Jan. 4th and prior week is week 52 or 53 of year prior
//      if false, week 01 starts on first weekStartDay of the year and prior week is week 00
function weekNumber(inDate: Date, weekStartDay: number, iso: boolean): number {
  const date = new Date(
    Date.UTC(inDate.getFullYear(), inDate.getMonth(), inDate.getDate()),
  );

  if (iso) {
    // ISO week: Week 1 contains January 4th, weeks start on Monday
    // Adjust to nearest Thursday
    const target = new Date(date);
    target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7)); // Nearest Thursday

    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 4)); // Jan 4
    const weekStart = new Date(yearStart);
    weekStart.setUTCDate(
      yearStart.getUTCDate() - ((yearStart.getUTCDay() + 6) % 7),
    ); // Monday of that week

    const diff = target.getTime() - weekStart.getTime();
    return 1 + Math.floor(diff / ONE_WEEK);
  } else {
    // Non-ISO week: Week 1 starts on the first weekStartDay of the year
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const startDay = yearStart.getUTCDay();
    const offset = (7 + (startDay - weekStartDay)) % 7;
    const firstWeekStart = new Date(yearStart);
    firstWeekStart.setUTCDate(yearStart.getUTCDate() + (7 - offset) % 7);

    if (date < firstWeekStart) {
      return 0;
    }

    const diff = date.getTime() - firstWeekStart.getTime();
    return 1 + Math.floor(diff / ONE_WEEK);
  }
}

export const osApi = new LuaTable({
  time: new LuaBuiltinFunction((_sf, tbl?: LuaTable) => {
    if (tbl) {
      // Build a date object from the table
      const date = new Date();
      if (!tbl.has("year")) {
        throw new Error("time(): year is required");
      }
      date.setFullYear(tbl.get("year"));
      if (!tbl.has("month")) {
        throw new Error("time(): month is required");
      }
      date.setMonth(tbl.get("month") - 1);
      if (!tbl.has("day")) {
        throw new Error("time(): day is required");
      }
      date.setDate(tbl.get("day"));
      date.setHours(tbl.get("hour") ?? 12);
      date.setMinutes(tbl.get("min") ?? 0);
      date.setSeconds(tbl.get("sec") ?? 0);
      return Math.floor(date.getTime() / 1000);
    } else {
      return Math.floor(Date.now() / 1000);
    }
  }),
  /**
   * Returns the difference, in seconds, from time t1 to time t2
   * (where the times are values returned by os.time). In POSIX,
   * Windows, and some other systems, this value is exactly t2-t1.
   */
  difftime: new LuaBuiltinFunction((_sf, t2: number, t1: number): number => {
    return t2 - t1;
  }),
  /**
   * Returns a string or a table containing date and time, formatted according to the given string format.
   * If the time argument is present, this is the time to be formatted (see the os.time function for a description of this value). Otherwise, date formats the current time.
   * If format starts with '!', then the date is formatted in Coordinated Universal Time. After this optional character, if format is the string "*t", then date returns a table with the following fields: year, month (1–12), day (1–31), hour (0–23), min (0–59), sec (0–61, due to leap seconds), wday (weekday, 1–7, Sunday is 1), yday (day of the year, 1–366), and isdst (daylight saving flag, a boolean). This last field may be absent if the information is not available.
   * If format is not "*t", then date returns the date as a string, formatted according to the same rules as the ISO C function strftime.
   * If format is absent, it defaults to "%c", which gives a human-readable date and time representation using the current locale.
   */
  date: new LuaBuiltinFunction((_sf, format: string, timestamp?: number) => {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();

    // Default Lua-like format when no format string is provided
    if (!format) {
      return date.toDateString() + " " + date.toLocaleTimeString();
    }

    if (format === "*t") {
      /*
            To produce a date table, we use the format string "*t". For instance, the following code

          temp = os.date("*t", 906000490)
      produces the table
          {year = 1998, month = 9, day = 16, yday = 259, wday = 4,
           hour = 23, min = 48, sec = 10, isdst = false}
           */
      return new LuaTable({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        yday: dayOfYear(date),
        wday: date.getDay() + 1,
        hour: date.getHours(),
        min: date.getMinutes(),
        sec: date.getSeconds(),
        // TODO: Add isdst
      });
    }

    // Define mappings for Lua-style placeholders
    const formatMap: { [key: string]: () => string } = {
      // Year
      "%Y": () => date.getFullYear().toString(),
      "%y": () => (date.getFullYear() % 100).toString().padStart(2, "0"),
      // Month
      "%m": () => (date.getMonth() + 1).toString().padStart(2, "0"),
      "%b": () => date.toLocaleString("en-US", { month: "short" }),
      "%B": () => date.toLocaleString("en-US", { month: "long" }),
      // Day
      "%d": () => date.getDate().toString().padStart(2, "0"),
      "%e": () => date.getDate().toString(),
      // Hour
      "%H": () => date.getHours().toString().padStart(2, "0"),
      "%I": () => (date.getHours() % 12 || 12).toString().padStart(2, "0"),
      // Minute
      "%M": () => date.getMinutes().toString().padStart(2, "0"),
      // Second
      "%S": () => date.getSeconds().toString().padStart(2, "0"),
      // AM/PM
      "%p": () => date.getHours() >= 12 ? "PM" : "AM",
      // Day of the week
      "%A": () => date.toLocaleString("en-US", { weekday: "long" }),
      "%a": () => date.toLocaleString("en-US", { weekday: "short" }),
      "%w": () => "" + date.getDay(),
      // Day of the year
      "%j": () => {
        return dayOfYear(date).toString().padStart(3, "0");
      },
      // Week
      "%U": () => weekNumber(date, 0, false).toString().padStart(2, "0"),
      "%W": () => weekNumber(date, 1, false).toString().padStart(2, "0"),
      "%V": () => weekNumber(date, 1, true).toString().padStart(2, "0"),
      // Time zone
      "%Z": () => {
        const match = date.toTimeString().match(/\((.*)\)/);
        return match ? match[1] : "";
      },
      "%z": () => {
        const offset = -date.getTimezoneOffset();
        const sign = offset >= 0 ? "+" : "-";
        const absOffset = Math.abs(offset);
        const hours = Math.floor(absOffset / 60).toString().padStart(
          2,
          "0",
        );
        const minutes = (absOffset % 60).toString().padStart(2, "0");
        return `${sign}${hours}${minutes}`;
      },
      // Literal %
      "%%": () => "%",
    };

    // Replace format placeholders with corresponding values
    return format.replace(/%[A-Za-z%]/g, (match) => {
      const formatter = formatMap[match];
      return formatter ? formatter() : match;
    });
  }),
});

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / ONE_DAY);
}
