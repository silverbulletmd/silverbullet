import { expect, test } from "vitest";
import { rank } from "./fuzzy.ts";

const pages = [
  { name: "Projects/SilverBullet", displayName: "SB" },
  { name: "Projects/Fuzzy Matching" },
  { name: "Journal/2026-08-06" },
  { name: "silver.md notes", aliases: ["shiny"] },
];

test("segment weighting", () => {
  const r = rank(pages, "silverbullet");
  expect(r[0].name).toEqual("Projects/SilverBullet");
});

test("alias matching", () => {
  const r = rank(pages, "shiny");
  expect(r.length).toEqual(1);
  expect(r[0].name).toEqual("silver.md notes");
});

test("zero-score token excludes", () => {
  expect(rank(pages, "xyzzynope").length).toEqual(0);
});

test("empty phrase returns all in orderId order", () => {
  const r = rank(pages, "", { orderId: (o) => o.name.length });
  expect(r.length).toEqual(4);
  expect(r.map((x) => x.name)).toEqual(
    [...r.map((x) => x.name)].sort((a, b) => a.length - b.length),
  );
});

test("custom fields", () => {
  const objs = [{ title: "Hello World" }, { title: "Goodbye" }];
  const r = rank(objs, "hello", { fields: { title: 1.0 } });
  expect(r.length).toEqual(1);
  expect(r[0].title).toEqual("Hello World");
});
