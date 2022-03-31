import { IndexEvent } from "../../webapp/app_event";
import { whiteOutQueries } from "./materialized_queries";
import { syscall } from "../lib/syscall";

type Item = {
  item: string;
  children?: string[];
};

const pageRefRe = /\[\[[^\]]+@\d+\]\]/;
const itemFullRe =
  /(?<prefix>[\t ]*)[\-\*]\s*([^\n]+)(\n\k<prefix>\s+[\-\*][^\n]+)*/g;

export async function indexItems({ name, text }: IndexEvent) {
  let items: { key: string; value: Item }[] = [];
  text = whiteOutQueries(text);
  for (let match of text.matchAll(itemFullRe)) {
    let entire = match[0];
    let item = match[2];
    if (item.match(pageRefRe)) {
      continue;
    }
    let pos = match.index!;
    let lines = entire.split("\n");

    let value: Item = {
      item,
    };
    if (lines.length > 1) {
      value.children = lines.slice(1);
    }
    items.push({
      key: `it:${pos}`,
      value,
    });
  }
  console.log("Found", items.length, "item(s)");
  await syscall("index.batchSet", name, items);
}
