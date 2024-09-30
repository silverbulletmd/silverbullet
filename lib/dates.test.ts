import { localDateString } from "$lib/dates.ts";

Deno.test("Dates", () => {
  console.log("Local date string", localDateString(new Date()));
});
