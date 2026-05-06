import { describe, expect, test } from "vitest";
import { Dictionary, canonicalize } from "./dictionary.ts";

describe("canonicalize", () => {
  test("null and undefined produce same key", () => {
    expect(canonicalize(null)).toBe(canonicalize(undefined));
  });

  test("booleans are distinct from strings", () => {
    expect(canonicalize(true)).not.toBe(canonicalize("true"));
    expect(canonicalize(false)).not.toBe(canonicalize("false"));
  });

  test("numbers are distinct from strings", () => {
    expect(canonicalize(42)).not.toBe(canonicalize("42"));
    expect(canonicalize(0)).not.toBe(canonicalize("0"));
  });

  test("special numbers", () => {
    const keys = [
      canonicalize(NaN),
      canonicalize(Infinity),
      canonicalize(-Infinity),
      canonicalize(-0),
      canonicalize(0),
    ];
    expect(new Set(keys).size).toBe(5);
  });

  test("-0 vs 0 are distinct", () => {
    expect(canonicalize(-0)).not.toBe(canonicalize(0));
  });

  test("strings are prefix-safe", () => {
    expect(canonicalize("\x01true")).not.toBe(canonicalize(true));
  });

  test("arrays produce deterministic keys", () => {
    expect(canonicalize([1, 2, 3])).toBe(canonicalize([1, 2, 3]));
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  test("objects with same keys in different order produce same key", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  test("nested objects are deterministic", () => {
    const a = { x: { b: 2, a: 1 }, y: [3, 4] };
    const b = { y: [3, 4], x: { a: 1, b: 2 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  test("empty string has distinct key", () => {
    expect(canonicalize("")).not.toBe(canonicalize(null));
    expect(canonicalize("")).not.toBe(canonicalize(0));
    expect(canonicalize("")).not.toBe(canonicalize(false));
  });
});

// Dictionary encode/decode

describe("Dictionary encode/decode", () => {
  test("first encode returns 0", () => {
    const d = new Dictionary();
    expect(d.encode("hello")).toBe(0);
  });

  test("sequential IDs", () => {
    const d = new Dictionary();
    expect(d.encode("a")).toBe(0);
    expect(d.encode("b")).toBe(1);
    expect(d.encode("c")).toBe(2);
  });

  test("duplicate encode returns same ID", () => {
    const d = new Dictionary();
    const id = d.encode("test");
    expect(d.encode("test")).toBe(id);
    expect(d.size).toBe(1);
  });

  test("tryEncode returns undefined for unknown", () => {
    const d = new Dictionary();
    expect(d.tryEncode("unknown")).toBeUndefined();
  });

  test("tryEncode returns ID for known value", () => {
    const d = new Dictionary();
    d.encode("known");
    expect(d.tryEncode("known")).toBe(0);
  });

  test("decodeValue roundtrips strings", () => {
    const d = new Dictionary();
    const id = d.encode("hello");
    expect(d.decodeValue(id)).toBe("hello");
  });

  test("decodeValue roundtrips booleans", () => {
    const d = new Dictionary();
    const t = d.encode(true);
    const f = d.encode(false);
    expect(d.decodeValue(t)).toBe(true);
    expect(d.decodeValue(f)).toBe(false);
  });

  test("decodeValue roundtrips numbers", () => {
    const d = new Dictionary();
    const id42 = d.encode(42);
    const idPi = d.encode(3.14);
    expect(d.decodeValue(id42)).toBe(42);
    expect(d.decodeValue(idPi)).toBe(3.14);
  });

  test("decodeValue roundtrips null", () => {
    const d = new Dictionary();
    const id = d.encode(null);
    expect(d.decodeValue(id)).toBe(null);
  });

  test("decodeValue roundtrips special numbers", () => {
    const d = new Dictionary();
    const nan = d.encode(NaN);
    const inf = d.encode(Infinity);
    const ninf = d.encode(-Infinity);
    const nz = d.encode(-0);
    expect(d.decodeValue(nan)).toBeNaN();
    expect(d.decodeValue(inf)).toBe(Infinity);
    expect(d.decodeValue(ninf)).toBe(-Infinity);
    expect(Object.is(d.decodeValue(nz), -0)).toBe(true);
  });

  test("decode unknown ID returns undefined", () => {
    const d = new Dictionary();
    expect(d.decode(999)).toBeUndefined();
    expect(d.decodeValue(999)).toBeUndefined();
  });

  test("mixed types get unique IDs", () => {
    const d = new Dictionary();
    const ids = [
      d.encode("42"),
      d.encode(42),
      d.encode(true),
      d.encode("true"),
      d.encode(null),
      d.encode(false),
      d.encode(0),
      d.encode("0"),
      d.encode(""),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// Dirty tracking

describe("Dictionary dirty tracking", () => {
  test("new dictionary is not dirty", () => {
    const d = new Dictionary();
    expect(d.dirty).toBe(false);
  });

  test("encode sets dirty", () => {
    const d = new Dictionary();
    d.encode("x");
    expect(d.dirty).toBe(true);
  });

  test("duplicate encode does not set dirty again", () => {
    const d = new Dictionary();
    d.encode("x");
    d.clearDirty();
    d.encode("x"); // same value
    expect(d.dirty).toBe(false);
  });

  test("clearDirty resets flag", () => {
    const d = new Dictionary();
    d.encode("x");
    d.clearDirty();
    expect(d.dirty).toBe(false);
  });
});

// Snapshot persistence

describe("Dictionary snapshot", () => {
  test("empty snapshot roundtrip", () => {
    const d = new Dictionary();
    const snap = d.toSnapshot();
    const d2 = new Dictionary(snap);
    expect(d2.size).toBe(0);
    expect(d2.nextId).toBe(0);
  });

  test("snapshot preserves IDs", () => {
    const d = new Dictionary();
    const id1 = d.encode("page");
    const id2 = d.encode("item");
    const id3 = d.encode(42);

    const d2 = new Dictionary(d.toSnapshot());
    expect(d2.tryEncode("page")).toBe(id1);
    expect(d2.tryEncode("item")).toBe(id2);
    expect(d2.tryEncode(42)).toBe(id3);
  });

  test("snapshot continuity — new encodes get next ID", () => {
    const d = new Dictionary();
    d.encode("a");
    d.encode("b");

    const d2 = new Dictionary(d.toSnapshot());
    expect(d2.encode("c")).toBe(2);
    expect(d2.nextId).toBe(3);
  });

  test("restored dictionary is not dirty", () => {
    const d = new Dictionary();
    d.encode("x");
    const d2 = new Dictionary(d.toSnapshot());
    expect(d2.dirty).toBe(false);
  });

  test("decodeValue works after snapshot restore", () => {
    const d = new Dictionary();
    const id = d.encode("hello");
    const d2 = new Dictionary(d.toSnapshot());
    // Original not cached after restore, but decode reconstructs it
    expect(d2.decodeValue(id)).toBe("hello");
  });

  test("complex values survive snapshot roundtrip", () => {
    const d = new Dictionary();
    const idArr = d.encode([1, 2, 3]);
    const idObj = d.encode({ a: 1, b: "two" });
    const idBool = d.encode(true);

    const d2 = new Dictionary(d.toSnapshot());
    expect(d2.decodeValue(idArr)).toEqual([1, 2, 3]);
    expect(d2.decodeValue(idObj)).toEqual({ a: 1, b: "two" });
    expect(d2.decodeValue(idBool)).toBe(true);
  });
});

// Capacity

describe("Dictionary capacity", () => {
  test("10000 unique strings", () => {
    const d = new Dictionary();
    for (let i = 0; i < 10000; i++) {
      expect(d.encode(`value_${i}`)).toBe(i);
    }
    expect(d.size).toBe(10000);
    expect(d.nextId).toBe(10000);
    // Spot check
    expect(d.tryEncode("value_0")).toBe(0);
    expect(d.tryEncode("value_9999")).toBe(9999);
  });

  test("snapshot roundtrip at scale", () => {
    const d = new Dictionary();
    for (let i = 0; i < 5000; i++) d.encode(`v${i}`);

    const d2 = new Dictionary(d.toSnapshot());
    expect(d2.size).toBe(5000);
    for (let i = 0; i < 5000; i++) {
      expect(d2.tryEncode(`v${i}`)).toBe(i);
    }
  });
});

// encodeIfFits

describe("Dictionary encodeIfFits", () => {
  test("returns undefined for null", () => {
    const d = new Dictionary();
    expect(d.encodeIfFits(null, 256, 100)).toBeUndefined();
  });

  test("returns undefined for undefined", () => {
    const d = new Dictionary();
    expect(d.encodeIfFits(undefined, 256, 100)).toBeUndefined();
  });

  test("encodes short string and returns ID", () => {
    const d = new Dictionary();
    const id = d.encodeIfFits("hello", 256, 100);
    expect(id).toBe(0);
    expect(d.size).toBe(1);
    expect(d.decodeValue(id!)).toBe("hello");
  });

  test("duplicate returns same ID without growing", () => {
    const d = new Dictionary();
    const id1 = d.encodeIfFits("x", 256, 100);
    const id2 = d.encodeIfFits("x", 256, 100);
    expect(id1).toBe(id2);
    expect(d.size).toBe(1);
  });

  test("returns undefined when canonical length exceeds maxBytes", () => {
    const d = new Dictionary();
    const id = d.encodeIfFits("a".repeat(300), 10, 100);
    expect(id).toBeUndefined();
    expect(d.size).toBe(0);
  });

  test("returns undefined when dictionary is at capacity", () => {
    const d = new Dictionary();
    d.encodeIfFits("first", 256, 1);
    expect(d.size).toBe(1);

    const id = d.encodeIfFits("second", 256, 1);
    expect(id).toBeUndefined();
    expect(d.size).toBe(1);
  });

  test("returns existing ID even when at capacity", () => {
    const d = new Dictionary();
    const id = d.encodeIfFits("only", 256, 1);
    expect(id).toBe(0);
    // Already exists — returned even though dict is full
    expect(d.encodeIfFits("only", 256, 1)).toBe(0);
    expect(d.size).toBe(1);
  });

  test("sets dirty flag on new entry", () => {
    const d = new Dictionary();
    d.encodeIfFits("val", 256, 100);
    expect(d.dirty).toBe(true);
  });

  test("does not set dirty on duplicate", () => {
    const d = new Dictionary();
    d.encodeIfFits("val", 256, 100);
    d.clearDirty();
    d.encodeIfFits("val", 256, 100);
    expect(d.dirty).toBe(false);
  });

  test("does not set dirty when rejected", () => {
    const d = new Dictionary();
    d.encodeIfFits("too long", 1, 100);
    expect(d.dirty).toBe(false);
  });

  test("IDs are consistent with encode()", () => {
    const d = new Dictionary();
    const id1 = d.encodeIfFits("a", 256, 100);
    const id2 = d.encode("a");
    const id3 = d.encode("b");
    const id4 = d.encodeIfFits("b", 256, 100);
    expect(id1).toBe(id2);
    expect(id3).toBe(id4);
  });

  test("encodes numbers and booleans", () => {
    const d = new Dictionary();
    const idNum = d.encodeIfFits(42, 256, 100);
    const idBool = d.encodeIfFits(true, 256, 100);
    expect(idNum).toBeDefined();
    expect(idBool).toBeDefined();
    expect(d.decodeValue(idNum!)).toBe(42);
    expect(d.decodeValue(idBool!)).toBe(true);
  });
});
