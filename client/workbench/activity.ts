export const ACTIVITY_DAYS = 140;

// date is a local calendar date (YYYY-MM-DD), not UTC
export type ActivityDay = { date: string; count: number };

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Buckets commit timestamps (unix seconds) into local calendar days, oldest first.
// The last entry is the local day of `now`. Days are stepped by calendar date, not
// by 86 400 000 ms, so DST transitions neither duplicate nor skip a day.
export function activityDays(
  commits: number[],
  now: Date,
  days: number = ACTIVITY_DAYS,
): ActivityDay[] {
  const result: ActivityDay[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const date = localDateKey(day);
    indexByDate.set(date, result.length);
    result.push({ date, count: 0 });
  }
  for (const t of commits) {
    const index = indexByDate.get(localDateKey(new Date(t * 1000)));
    if (index !== undefined) result[index].count++;
  }
  return result;
}

export function editsLast7Days(days: ActivityDay[]): number {
  return days.slice(-7).reduce((sum, d) => sum + d.count, 0);
}

export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * count) / max))) as
    | 1
    | 2
    | 3
    | 4;
}

// Weeks start on Monday; the next helpers lay days out as GitHub does: one column per week
const WEEK_START = 1;
// Fewer columns than this leaves no room for a month label beside the previous one
const MIN_LABEL_GAP = 3;

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Columns of 7 days (Monday first), padded with nulls before the first day and after the last. */
export function activityWeeks(days: ActivityDay[]): (ActivityDay | null)[][] {
  if (days.length === 0) return [];
  const lead = (parseDate(days[0].date).getDay() - WEEK_START + 7) % 7;
  const cells: (ActivityDay | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (ActivityDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Short month names over the first column of each month, dropping ones that would crowd the previous. */
export function monthLabels(
  weeks: (ActivityDay | null)[][],
  locale?: string,
): { column: number; label: string }[] {
  const labels: { column: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, column) => {
    const first = week.find((d) => d !== null);
    if (!first) return;
    const date = parseDate(first.date);
    if (date.getMonth() === lastMonth) return;
    lastMonth = date.getMonth();
    const label = date.toLocaleString(locale, { month: "short" });
    const prev = labels[labels.length - 1];
    if (prev && column - prev.column < MIN_LABEL_GAP) {
      // The earlier month only had a sliver of columns: the newer one wins
      labels.pop();
    }
    labels.push({ column, label });
  });
  return labels;
}

/** Short weekday names for the 7 rows, Monday first. */
export function weekdayLabels(locale?: string): string[] {
  // 2024-01-01 was a Monday
  return [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Date(2024, 0, 1 + i).toLocaleString(locale, { weekday: "short" }),
  );
}
