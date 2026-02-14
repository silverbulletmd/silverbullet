import { expect, test } from "vitest";
import { localDateString } from "./dates.ts";

test("Dates", () => {
  console.log("Local date string", localDateString(new Date()));
});
