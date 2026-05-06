import { expect, test } from "vitest";
import { MCVList } from "./mcv.ts";

test("empty MCV estimates zero", () => {
  const m = new MCVList();
  expect(m.totalCount()).toBe(0);
  expect(m.trackedSize()).toBe(0);
});

test("insert and count", () => {
  const m = new MCVList({ capacity: 4 });
  m.insert("a");
  m.insert("a");
  m.insert("a");
  m.insert("b");
  m.insert("b");
  m.insert("c");
  expect(m.getCount("a")).toBe(3);
  expect(m.getCount("b")).toBe(2);
  expect(m.getCount("c")).toBe(1);
  expect(m.totalCount()).toBe(6);
});

test("delete reverses insert", () => {
  const m = new MCVList();
  m.insert("x");
  m.insert("x");
  m.insert("y");
  m.delete("x");
  expect(m.getCount("x")).toBe(1);
  m.delete("x");
  expect(m.getCount("x")).toBe(0);
  expect(m.totalCount()).toBe(1);
});

test("merge combines two MCVs", () => {
  const a = new MCVList({ capacity: 4 });
  const b = new MCVList({ capacity: 4 });
  a.insert("x");
  a.insert("x");
  a.insert("y");
  b.insert("x");
  b.insert("z");
  b.insert("z");
  a.merge(b);
  expect(a.getCount("x")).toBe(3);
  expect(a.getCount("y")).toBe(1);
  expect(a.getCount("z")).toBe(2);
});

test("subtract reverses merge", () => {
  const a = new MCVList({ capacity: 4 });
  const b = new MCVList({ capacity: 4 });
  a.insert("x");
  a.insert("x");
  a.insert("y");
  b.insert("x");
  b.insert("z");
  const origX = a.getCount("x");
  const origY = a.getCount("y");
  a.merge(b);
  a.subtract(b);
  expect(a.getCount("x")).toBe(origX);
  expect(a.getCount("y")).toBe(origY);
});

test("serialize/deserialize round-trip", () => {
  const m = new MCVList({ capacity: 8 });
  m.insert("a");
  m.insert("a");
  m.insert("b");
  const s = m.serialize();
  const restored = MCVList.deserialize(s);
  expect(restored.getCount("a")).toBe(2);
  expect(restored.getCount("b")).toBe(1);
  expect(restored.capacity).toBe(8);
});

test("entries sorted by count descending", () => {
  const m = new MCVList({ capacity: 8 });
  m.insert("rare");
  m.insert("common");
  m.insert("common");
  m.insert("common");
  m.insert("mid");
  m.insert("mid");
  const entries = m.entries();
  expect(entries[0].value).toBe("common");
  expect(entries[0].count).toBe(3);
  expect(entries[1].value).toBe("mid");
  expect(entries[2].value).toBe("rare");
});

test("capacity overflow goes to remainder", () => {
  const m = new MCVList({ capacity: 2 });
  m.insert("a");
  m.insert("b");
  m.insert("c");
  expect(m.trackedSize()).toBeLessThanOrEqual(2);
  expect(m.totalCount()).toBe(3);
});

test("estimateMatchFraction with MCV gives better estimate than uniform", () => {
  // Simulate: 228 pages, 30 paragraphs on 9 distinct pages
  const leftMcv = new MCVList({ capacity: 32 });
  // All 228 page names are distinct — populate left MCV with some names
  for (let i = 0; i < 228; i++) leftMcv.insert(`page_${i}`);

  const rightMcv = new MCVList({ capacity: 32 });
  for (let i = 0; i < 30; i++) {
    const pageIdx =
      i < 5
        ? 0
        : i < 9
          ? 1
          : i < 12
            ? 2
            : i < 15
              ? 3
              : i < 18
                ? 4
                : i < 21
                  ? 5
                  : i < 24
                    ? 6
                    : i < 27
                      ? 7
                      : 8;
    rightMcv.insert(`page_${pageIdx}`);
  }

  const result = MCVList.estimateMatchFraction(
    leftMcv,
    rightMcv,
    228,
    30,
    228,
    9,
  );

  expect(result.matchedLeftFraction).toBeLessThan(0.06);
  expect(result.matchedLeftFraction).toBeGreaterThan(0.02);
  const matchedLeftRows = result.matchedLeftFraction * 228;
  expect(matchedLeftRows).toBeGreaterThan(5);
  expect(matchedLeftRows).toBeLessThan(15);
});
