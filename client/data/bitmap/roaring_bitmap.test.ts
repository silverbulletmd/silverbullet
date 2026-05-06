import { describe, expect, test } from "vitest";
import { RoaringBitmap } from "./roaring_bitmap.ts";

// Helpers

function fromArray(values: number[]): RoaringBitmap {
  const bm = new RoaringBitmap();
  for (const v of values) bm.add(v);
  return bm;
}

function setIntersect(a: number[], b: number[]): number[] {
  const s = new Set(b);
  return a.filter((v) => s.has(v)).sort((a, b) => a - b);
}

function setUnion(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((a, b) => a - b);
}

function setDiff(a: number[], b: number[]): number[] {
  const s = new Set(b);
  return a.filter((v) => !s.has(v)).sort((a, b) => a - b);
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

// Seeded pseudo-random for reproducible tests
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Basic operations

describe("RoaringBitmap basic operations", () => {
  test("empty bitmap", () => {
    const bm = new RoaringBitmap();
    expect(bm.cardinality()).toBe(0);
    expect(bm.isEmpty()).toBe(true);
    expect(bm.has(0)).toBe(false);
    expect(bm.has(42)).toBe(false);
    expect(bm.toArray()).toEqual([]);
  });

  test("single add/has/remove", () => {
    const bm = new RoaringBitmap();
    bm.add(42);
    expect(bm.cardinality()).toBe(1);
    expect(bm.has(42)).toBe(true);
    expect(bm.has(43)).toBe(false);
    bm.remove(42);
    expect(bm.cardinality()).toBe(0);
    expect(bm.isEmpty()).toBe(true);
  });

  test("add duplicate is idempotent", () => {
    const bm = new RoaringBitmap();
    bm.add(10);
    bm.add(10);
    bm.add(10);
    expect(bm.cardinality()).toBe(1);
  });

  test("remove nonexistent is no-op", () => {
    const bm = new RoaringBitmap();
    bm.add(5);
    bm.remove(999);
    expect(bm.cardinality()).toBe(1);
    expect(bm.has(5)).toBe(true);
  });

  test("sequential adds produce sorted output", () => {
    const bm = new RoaringBitmap();
    const values = [50, 10, 30, 20, 40];
    for (const v of values) bm.add(v);
    expect(bm.toArray()).toEqual([10, 20, 30, 40, 50]);
  });
});

// ArrayContainer

describe("ArrayContainer specifics", () => {
  test("sorted order after random insertions", () => {
    const rng = mulberry32(1);
    const bm = new RoaringBitmap();
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const v = (rng() * 60000) | 0;
      bm.add(v);
      values.add(v);
    }
    const expected = [...values].sort((a, b) => a - b);
    expect(bm.toArray()).toEqual(expected);
  });

  test("cardinality tracking through add/remove mix", () => {
    const bm = new RoaringBitmap();
    for (let i = 0; i < 50; i++) bm.add(i);
    expect(bm.cardinality()).toBe(50);
    for (let i = 0; i < 25; i++) bm.remove(i * 2);
    expect(bm.cardinality()).toBe(25);
  });
});

// BitmapContainer (promotion/demotion)

describe("BitmapContainer promotion/demotion", () => {
  test("promote at 4096 boundary", () => {
    const bm = new RoaringBitmap();
    for (let i = 0; i < 4096; i++) bm.add(i);
    expect(bm.cardinality()).toBe(4096);
    expect(bm.has(0)).toBe(true);
    expect(bm.has(4095)).toBe(true);
  });

  test("demote below 4096", () => {
    const bm = new RoaringBitmap();
    for (let i = 0; i < 4096; i++) bm.add(i);
    bm.remove(0);
    expect(bm.cardinality()).toBe(4095);
    expect(bm.has(0)).toBe(false);
    expect(bm.has(1)).toBe(true);
  });

  test("large sparse bitmap", () => {
    const bm = new RoaringBitmap();
    // Add 5000 even numbers (all in MSB 0) — forces BitmapContainer
    for (let i = 0; i < 10000; i += 2) bm.add(i);
    expect(bm.cardinality()).toBe(5000);
    expect(bm.has(0)).toBe(true);
    expect(bm.has(1)).toBe(false);
    expect(bm.has(9998)).toBe(true);
  });
});

// RunContainer

describe("RunContainer specifics", () => {
  test("dense sequential range stored efficiently", () => {
    const bm = fromArray(range(100, 200));
    expect(bm.cardinality()).toBe(101);
    expect(bm.has(100)).toBe(true);
    expect(bm.has(200)).toBe(true);
    expect(bm.has(99)).toBe(false);
    expect(bm.has(201)).toBe(false);
  });

  test("multiple disjoint runs", () => {
    const vals = [...range(10, 20), ...range(50, 60), ...range(100, 110)];
    const bm = fromArray(vals);
    expect(bm.cardinality()).toBe(11 + 11 + 11);
    expect(bm.toArray()).toEqual(vals.sort((a, b) => a - b));
  });

  test("adjacent run merging", () => {
    const bm = fromArray([...range(10, 20), ...range(22, 30)]);
    bm.add(21); // bridge the gap
    expect(bm.has(21)).toBe(true);
    expect(bm.toArray()).toEqual(range(10, 30));
  });

  test("run splitting on remove", () => {
    const bm = fromArray(range(10, 20));
    bm.remove(15);
    expect(bm.has(15)).toBe(false);
    expect(bm.has(14)).toBe(true);
    expect(bm.has(16)).toBe(true);
    expect(bm.toArray()).toEqual([...range(10, 14), ...range(16, 20)]);
  });
});

// Cross-container set operations

describe("Set operations: and", () => {
  test("Array intersect Array — overlapping", () => {
    const a = fromArray([1, 2, 3, 4, 5]);
    const b = fromArray([3, 4, 5, 6, 7]);
    expect(RoaringBitmap.and(a, b).toArray()).toEqual([3, 4, 5]);
  });

  test("Array intersect Array — disjoint", () => {
    const a = fromArray([1, 2]);
    const b = fromArray([3, 4]);
    expect(RoaringBitmap.and(a, b).isEmpty()).toBe(true);
  });

  test("Array intersect Array — subset", () => {
    const a = fromArray([1, 2, 3, 4, 5]);
    const b = fromArray([2, 4]);
    expect(RoaringBitmap.and(a, b).toArray()).toEqual([2, 4]);
  });

  test("Array intersect Bitmap", () => {
    const a = fromArray(range(0, 100));
    const b = fromArray(range(50, 5000)); // forces bitmap
    const result = RoaringBitmap.and(a, b);
    expect(result.toArray()).toEqual(range(50, 100));
  });

  test("Bitmap intersect Bitmap", () => {
    const a = fromArray(range(0, 5000));
    const b = fromArray(range(4000, 9000));
    expect(RoaringBitmap.and(a, b).toArray()).toEqual(range(4000, 5000));
  });

  test("Run intersect Run — overlapping", () => {
    const a = fromArray(range(100, 200));
    const b = fromArray(range(150, 250));
    expect(RoaringBitmap.and(a, b).toArray()).toEqual(range(150, 200));
  });

  test("Run intersect Run — disjoint", () => {
    const a = fromArray(range(10, 20));
    const b = fromArray(range(30, 40));
    expect(RoaringBitmap.and(a, b).isEmpty()).toBe(true);
  });

  test("commutativity", () => {
    const a = fromArray([1, 3, 5, 7, 9, 100, 200]);
    const b = fromArray([2, 3, 5, 8, 100]);
    expect(RoaringBitmap.and(a, b).toArray()).toEqual(
      RoaringBitmap.and(b, a).toArray(),
    );
  });

  test("identity: and(a, empty) == empty", () => {
    const a = fromArray([1, 2, 3]);
    const empty = new RoaringBitmap();
    expect(RoaringBitmap.and(a, empty).isEmpty()).toBe(true);
  });
});

describe("Set operations: or", () => {
  test("Array | Array", () => {
    const a = fromArray([1, 3, 5]);
    const b = fromArray([2, 3, 4]);
    expect(RoaringBitmap.or(a, b).toArray()).toEqual([1, 2, 3, 4, 5]);
  });

  test("commutativity", () => {
    const a = fromArray([10, 20, 30]);
    const b = fromArray([20, 40, 50]);
    expect(RoaringBitmap.or(a, b).toArray()).toEqual(
      RoaringBitmap.or(b, a).toArray(),
    );
  });

  test("identity: or(a, empty) == a", () => {
    const a = fromArray([1, 2, 3]);
    const empty = new RoaringBitmap();
    expect(RoaringBitmap.or(a, empty).toArray()).toEqual(a.toArray());
  });

  test("Array | Bitmap", () => {
    const a = fromArray([1, 2, 3]);
    const b = fromArray(range(0, 5000));
    const result = RoaringBitmap.or(a, b);
    expect(result.cardinality()).toBe(5001);
  });

  test("Run | Run merging", () => {
    const a = fromArray(range(10, 20));
    const b = fromArray(range(21, 30));
    const result = RoaringBitmap.or(a, b);
    expect(result.toArray()).toEqual(range(10, 30));
  });
});

describe("Set operations: andNot", () => {
  test("Array \\ Array", () => {
    const a = fromArray([1, 2, 3, 4, 5]);
    const b = fromArray([2, 4]);
    expect(RoaringBitmap.andNot(a, b).toArray()).toEqual([1, 3, 5]);
  });

  test("andNot(a, a) == empty", () => {
    const a = fromArray([1, 2, 3, 4, 5]);
    expect(RoaringBitmap.andNot(a, a).isEmpty()).toBe(true);
  });

  test("andNot(a, empty) == a", () => {
    const a = fromArray([1, 2, 3]);
    const empty = new RoaringBitmap();
    expect(RoaringBitmap.andNot(a, empty).toArray()).toEqual(a.toArray());
  });

  test("Bitmap \\ Array", () => {
    const a = fromArray(range(0, 5000));
    const b = fromArray([100, 200, 300]);
    const result = RoaringBitmap.andNot(a, b);
    expect(result.cardinality()).toBe(4998);
    expect(result.has(100)).toBe(false);
    expect(result.has(101)).toBe(true);
  });

  test("Bitmap \\ Bitmap", () => {
    const a = fromArray(range(0, 5000));
    const b = fromArray(range(0, 2000));
    expect(RoaringBitmap.andNot(a, b).toArray()).toEqual(range(2001, 5000));
  });

  test("Run \\ Run", () => {
    const a = fromArray(range(10, 30));
    const b = fromArray(range(15, 25));
    expect(RoaringBitmap.andNot(a, b).toArray()).toEqual([
      ...range(10, 14),
      ...range(26, 30),
    ]);
  });
});

// Multi-MSB-key operations

describe("Multi-MSB-key", () => {
  test("values in different MSB buckets", () => {
    const bm = new RoaringBitmap();
    bm.add(0);
    bm.add(65536);
    bm.add(131072);
    expect(bm.cardinality()).toBe(3);
    expect(bm.toArray()).toEqual([0, 65536, 131072]);
  });

  test("intersection with partial MSB overlap", () => {
    const a = fromArray([0, 1, 65536, 65537]);
    const b = fromArray([1, 65537, 131072]);
    expect(RoaringBitmap.and(a, b).toArray()).toEqual([1, 65537]);
  });

  test("union merges MSB keys", () => {
    const a = fromArray([0, 65536]);
    const b = fromArray([131072]);
    expect(RoaringBitmap.or(a, b).toArray()).toEqual([0, 65536, 131072]);
  });

  test("andNot only affects matching MSB keys", () => {
    const a = fromArray([0, 1, 65536]);
    const b = fromArray([1, 131072]);
    expect(RoaringBitmap.andNot(a, b).toArray()).toEqual([0, 65536]);
  });
});

// Serialization

describe("Serialization roundtrip", () => {
  test("empty bitmap", () => {
    const bm = new RoaringBitmap();
    const rt = RoaringBitmap.deserialize(bm.serialize());
    expect(rt.isEmpty()).toBe(true);
  });

  test("ArrayContainer roundtrip", () => {
    const bm = fromArray([1, 10, 100, 1000]);
    const rt = RoaringBitmap.deserialize(bm.serialize());
    expect(rt.toArray()).toEqual([1, 10, 100, 1000]);
  });

  test("BitmapContainer roundtrip", () => {
    const bm = fromArray(range(0, 5000));
    const rt = RoaringBitmap.deserialize(bm.serialize());
    expect(rt.toArray()).toEqual(range(0, 5000));
  });

  test("RunContainer roundtrip", () => {
    const bm = fromArray(range(100, 200));
    const rt = RoaringBitmap.deserialize(bm.serialize());
    expect(rt.toArray()).toEqual(range(100, 200));
  });

  test("mixed container types", () => {
    const bm = new RoaringBitmap();
    // MSB 0: array
    for (const v of [1, 10, 100]) bm.add(v);
    // MSB 1: dense run
    for (const v of range(65536, 65636)) bm.add(v);
    // MSB 2: bitmap
    for (const v of range(131072, 136000)) bm.add(v);
    const rt = RoaringBitmap.deserialize(bm.serialize());
    expect(rt.toArray()).toEqual(bm.toArray());
    expect(rt.cardinality()).toBe(bm.cardinality());
  });

  test("large bitmap roundtrip", () => {
    const rng = mulberry32(42);
    const values = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      values.add((rng() * 1000000) >>> 0);
    }
    const bm = fromArray([...values]);
    const rt = RoaringBitmap.deserialize(bm.serialize());
    expect(rt.toArray()).toEqual(bm.toArray());
    expect(rt.cardinality()).toBe(bm.cardinality());
  });
});

// Edge cases

describe("Edge cases", () => {
  test("value 0", () => {
    const bm = new RoaringBitmap();
    bm.add(0);
    expect(bm.has(0)).toBe(true);
    expect(bm.cardinality()).toBe(1);
    bm.remove(0);
    expect(bm.isEmpty()).toBe(true);
  });

  test("value 0xFFFFFFFF", () => {
    const bm = new RoaringBitmap();
    bm.add(0xffffffff);
    expect(bm.has(0xffffffff)).toBe(true);
    expect(bm.cardinality()).toBe(1);
    expect(bm.toArray()).toEqual([0xffffffff]);
  });

  test("value 0xFFFF (max LSB in MSB=0)", () => {
    const bm = new RoaringBitmap();
    bm.add(0xffff);
    expect(bm.has(0xffff)).toBe(true);
  });

  test("value 0x10000 (min value in MSB=1)", () => {
    const bm = new RoaringBitmap();
    bm.add(0x10000);
    expect(bm.has(0x10000)).toBe(true);
    expect(bm.toArray()).toEqual([0x10000]);
  });

  test("promotion boundary 4095->4096", () => {
    const bm = new RoaringBitmap();
    for (let i = 0; i < 4095; i++) bm.add(i);
    expect(bm.cardinality()).toBe(4095);
    bm.add(4095);
    expect(bm.cardinality()).toBe(4096);
    expect(bm.has(4095)).toBe(true);
  });

  test("demotion boundary 4096->4095", () => {
    const bm = new RoaringBitmap();
    for (let i = 0; i < 4096; i++) bm.add(i);
    bm.remove(0);
    expect(bm.cardinality()).toBe(4095);
    expect(bm.has(0)).toBe(false);
    expect(bm.has(1)).toBe(true);
  });

  test("intersection producing empty", () => {
    const a = fromArray([1, 2, 3]);
    const b = fromArray([4, 5, 6]);
    expect(RoaringBitmap.and(a, b).isEmpty()).toBe(true);
  });
});

// Property-based correctness

describe("Property-based correctness", () => {
  const rng = mulberry32(123);

  function randomArray(n: number, max: number): number[] {
    const s = new Set<number>();
    while (s.size < n) s.add((rng() * max) >>> 0);
    return [...s];
  }

  test("toArray matches Set", () => {
    const values = randomArray(500, 200000);
    const bm = fromArray(values);
    expect(bm.toArray()).toEqual([...new Set(values)].sort((a, b) => a - b));
    expect(bm.cardinality()).toBe(new Set(values).size);
  });

  test("and matches set intersection", () => {
    const a = randomArray(300, 100000);
    const b = randomArray(300, 100000);
    const bmResult = RoaringBitmap.and(fromArray(a), fromArray(b)).toArray();
    expect(bmResult).toEqual(setIntersect(a, b));
  });

  test("or matches set union", () => {
    const a = randomArray(300, 100000);
    const b = randomArray(300, 100000);
    const bmResult = RoaringBitmap.or(fromArray(a), fromArray(b)).toArray();
    expect(bmResult).toEqual(setUnion(a, b));
  });

  test("andNot matches set difference", () => {
    const a = randomArray(300, 100000);
    const b = randomArray(300, 100000);
    const bmResult = RoaringBitmap.andNot(fromArray(a), fromArray(b)).toArray();
    expect(bmResult).toEqual(setDiff(a, b));
  });

  test("large random: and/or/andNot consistency", () => {
    const a = randomArray(2000, 500000);
    const b = randomArray(2000, 500000);
    const bmA = fromArray(a);
    const bmB = fromArray(b);

    const andCard = RoaringBitmap.and(bmA, bmB).cardinality();
    const diffCard = RoaringBitmap.andNot(bmA, bmB).cardinality();
    expect(andCard + diffCard).toBe(bmA.cardinality());

    const orCard = RoaringBitmap.or(bmA, bmB).cardinality();
    expect(orCard).toBe(bmA.cardinality() + bmB.cardinality() - andCard);
  });
});
