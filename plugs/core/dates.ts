import { insertAtCursor } from "plugos-silverbullet-syscall/editor";
import { IndexEvent } from "../../webapp/app_event";
import { batchSet } from "plugos-silverbullet-syscall";
import { whiteOutQueries } from "./materialized_queries";

const dateMatchRegex = /(\d{4}\-\d{2}\-\d{2})/g;

// Index key space:
// d:[date]:page@pos

export async function indexDates({ name, text }: IndexEvent) {
  let dates: { key: string; value: boolean }[] = [];
  text = whiteOutQueries(text);
  console.log("Now date indexing", name);
  for (let match of text.matchAll(dateMatchRegex)) {
    // console.log("Date match", match[0]);
    dates.push({
      key: `d:${match[0]}:${name}@${match.index}`,
      value: true,
    });
  }
  console.log("Found", dates.length, "dates");
  await batchSet(name, dates);
}

export async function insertToday() {
  await insertAtCursor(new Date().toISOString().split("T")[0]);
}

export async function insertTomorrow() {
  let d = new Date();
  d.setDate(d.getDate() + 1);
  await insertAtCursor(d.toISOString().split("T")[0]);
}
