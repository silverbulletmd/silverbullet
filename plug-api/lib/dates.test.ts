import { localDateString } from "./dates.ts";

Deno.test("Dates", () => {
  console.log("Local date string", localDateString(new Date()));
});
