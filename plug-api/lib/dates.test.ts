import { expect, test } from "vitest";
import { localDateString, relativeTime } from "./dates.ts";

test("Dates", () => {
  console.log("Local date string", localDateString(new Date()));
});

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test.each([
  [NOW, "now"],
  [NOW - 10 * MINUTE, "10 minutes ago"],
  [NOW - 3 * HOUR, "3 hours ago"],
  // `numeric: "auto"` is what makes the -1 cases read as words.
  [NOW - DAY, "yesterday"],
  [NOW - 4 * DAY, "4 days ago"],
  [NOW - 30 * DAY, "4 weeks ago"],
  [NOW - 90 * DAY, "3 months ago"],
  [NOW - 400 * DAY, "last year"],
  [NOW + 5 * MINUTE, "in 5 minutes"],
])("relativeTime(%i) reads as %s", (timestamp, expected) => {
  expect(relativeTime(timestamp, "en-US", NOW)).toBe(expected);
});
