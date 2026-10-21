import { describe, expect, test } from "vitest";
import {
  ACTIVITY_DAYS,
  type ActivityDay,
  activityDays,
  activityWeeks,
  editsLast7Days,
  heatLevel,
  monthLabels,
  weekdayLabels,
} from "./activity.ts";

// Pin the zone so DST and UTC+/- boundary cases run the same way in any CI.
// activity.ts does no Date work at import time, so setting this after the imports is safe.
process.env.TZ = "Europe/Amsterdam";

// Local-time constructors keep these assertions readable and exact
function localSeconds(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Math.floor(new Date(year, month, day, hour, minute).getTime() / 1000);
}

function dates(days: ActivityDay[]): string[] {
  return days.map((d) => d.date);
}

function fromCounts(counts: number[]): ActivityDay[] {
  return counts.map((count, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    count,
  }));
}

describe("time zone pin", () => {
  test("Europe/Amsterdam offsets hold across summer and winter", () => {
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 11, 1).getTimezoneOffset()).toBe(-60);
  });
});

describe("activityDays", () => {
  test("activityDays returns one entry per day, oldest first, ending today", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const days = activityDays([], now, 7);
    expect(dates(days)).toEqual([
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
    ]);
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  test("a commit at 23:30 local counts on that day", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const days = activityDays([localSeconds(2026, 9, 18, 23, 30)], now, 7);
    const day = days.find((d) => d.date === "2026-10-18");
    expect(day?.count).toBe(1);
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(1);
  });

  test("a commit at 00:30 local lands on that local day, not the UTC day before", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const days = activityDays([localSeconds(2026, 9, 19, 0, 30)], now, 7);
    expect(days[days.length - 1]).toEqual({ date: "2026-10-19", count: 1 });
  });

  test("commits outside the window are ignored", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const commits = [
      localSeconds(2026, 9, 12, 23, 59), // day before the window
      localSeconds(2026, 9, 20, 0, 1), // tomorrow
    ];
    const days = activityDays(commits, now, 7);
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(0);
  });

  test("defaults to ACTIVITY_DAYS entries", () => {
    const now = new Date(2026, 9, 19, 12, 0);
    const days = activityDays([], now);
    expect(ACTIVITY_DAYS).toBe(140);
    expect(days).toHaveLength(ACTIVITY_DAYS);
    expect(days[days.length - 1].date).toBe("2026-10-19");
  });

  test("dates are consecutive calendar days across a DST change", () => {
    const now = new Date(2026, 9, 26, 12, 0);
    const days = activityDays([], now, 5);
    expect(dates(days)).toEqual([
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });

  // Naive now - i*86400000 stepping gives 10-25 twice here, because 10-25 is a 25-hour day
  test("DST end does not duplicate a day when now is late in the evening", () => {
    const now = new Date(2026, 9, 26, 23, 30);
    const days = activityDays([localSeconds(2026, 9, 25, 2, 30)], now, 3);
    expect(dates(days)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(days.find((d) => d.date === "2026-10-25")?.count).toBe(1);
  });

  // Naive stepping gives 03-27 and skips 03-29 here, because 03-29 is a 23-hour day
  test("DST start does not skip a day when now is just after midnight", () => {
    const now = new Date(2026, 2, 30, 0, 30);
    const days = activityDays([], now, 3);
    expect(dates(days)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  test("DST end does not duplicate or skip a day at midday", () => {
    const now = new Date(2026, 9, 26, 12, 0);
    const days = activityDays([localSeconds(2026, 9, 25, 2, 30)], now, 3);
    expect(dates(days)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(days.find((d) => d.date === "2026-10-25")?.count).toBe(1);
  });
});

describe("editsLast7Days", () => {
  test("sums the last 7 entries only", () => {
    const counts = [100, 1, 2, 3, 4, 5, 6, 7];
    expect(editsLast7Days(fromCounts(counts))).toBe(28);
  });
});

describe("heatLevel", () => {
  test("heatLevel maps zero to 0 and the max to 4", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });

  test("any non-zero count is at least level 1", () => {
    expect(heatLevel(1, 1000)).toBe(1);
  });
});

describe("GitHub-style layout", () => {
  // 2026-10-19 is a Monday, so 140 days back starts on Tuesday 2026-06-02
  const days = activityDays([], new Date(2026, 9, 19, 12), 140);
  const weeks = activityWeeks(days);

  test("one column per Monday-first week, padded with nulls", () => {
    expect(weeks).toHaveLength(21);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toBeNull();
    expect(weeks[0][1]?.date).toBe("2026-06-02");
    expect(weeks[20][0]?.date).toBe("2026-10-19");
    expect(weeks[20].slice(1).every((d) => d === null)).toBe(true);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(140);
  });

  test("each row is one weekday", () => {
    // Row 0 is Monday: 2026-06-08 is a Monday
    expect(weeks[1][0]?.date).toBe("2026-06-08");
    expect(weeks[1][6]?.date).toBe("2026-06-14");
  });

  test("month labels sit on the first week of each month", () => {
    expect(monthLabels(weeks, "en")).toEqual([
      { column: 0, label: "Jun" },
      { column: 5, label: "Jul" },
      { column: 9, label: "Aug" },
      { column: 14, label: "Sep" },
      { column: 18, label: "Oct" },
    ]);
  });

  test("a month label too close to the previous one is dropped", () => {
    // Starting on 2026-06-28 (a Sunday): June gets one column before July
    const short = activityWeeks(activityDays([], new Date(2026, 7, 9, 12), 43));
    expect(monthLabels(short, "en").map((l) => l.label)).toEqual([
      "Jul",
      "Aug",
    ]);
  });

  test("weekday labels on every row, Monday first", () => {
    expect(weekdayLabels("en")).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });
});
