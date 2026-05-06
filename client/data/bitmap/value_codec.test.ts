import { describe, expect, test } from "vitest";
import {
  bytesToHex,
  canonicalValueToHex,
  decodeCanonicalValue,
  encodeCanonicalValue,
  hexToBytes,
} from "./value_codec.ts";

function roundtrip(value: unknown) {
  return decodeCanonicalValue(encodeCanonicalValue(value));
}

describe("value_codec scalar roundtrip", () => {
  test("null", () => {
    expect(roundtrip(null)).toBe(null);
  });

  test("booleans", () => {
    expect(roundtrip(false)).toBe(false);
    expect(roundtrip(true)).toBe(true);
  });

  test("numbers", () => {
    expect(roundtrip(0)).toBe(0);
    expect(Object.is(roundtrip(-0), -0)).toBe(true);
    expect(roundtrip(42)).toBe(42);
    expect(roundtrip(-123.5)).toBe(-123.5);
    expect(roundtrip(Infinity)).toBe(Infinity);
    expect(roundtrip(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(roundtrip(NaN) as number)).toBe(true);
  });

  test("strings", () => {
    expect(roundtrip("")).toBe("");
    expect(roundtrip("hello")).toBe("hello");
    expect(roundtrip("žluťoučký kůň")).toBe("žluťoučký kůň");
    expect(roundtrip("\0inside")).toBe("\0inside");
  });
});

describe("value_codec compound roundtrip", () => {
  test("arrays", () => {
    expect(roundtrip([])).toEqual([]);
    expect(roundtrip([1, true, null, "x"])).toEqual([1, true, null, "x"]);
  });

  test("objects", () => {
    expect(roundtrip({})).toEqual({});
    expect(roundtrip({ a: 1, b: true, c: "x", d: null })).toEqual({
      a: 1,
      b: true,
      c: "x",
      d: null,
    });
  });

  test("nested structures", () => {
    const value = {
      name: "page",
      flags: [true, false, null],
      meta: {
        count: 3,
        tags: ["a", "b"],
      },
    };
    expect(roundtrip(value)).toEqual(value);
  });
});

describe("value_codec canonicality", () => {
  test("object key order does not matter", () => {
    const a = canonicalValueToHex({ b: 2, a: 1 });
    const b = canonicalValueToHex({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  test("nested object key order does not matter", () => {
    const a = canonicalValueToHex({
      z: [1, 2],
      x: { b: 2, a: 1 },
    });
    const b = canonicalValueToHex({
      x: { a: 1, b: 2 },
      z: [1, 2],
    });
    expect(a).toBe(b);
  });

  test("string and number are distinct", () => {
    expect(canonicalValueToHex("42")).not.toBe(canonicalValueToHex(42));
  });

  test("true and 'true' are distinct", () => {
    expect(canonicalValueToHex(true)).not.toBe(canonicalValueToHex("true"));
  });

  test("null and false are distinct", () => {
    expect(canonicalValueToHex(null)).not.toBe(canonicalValueToHex(false));
  });

  test("0 and -0 are distinct", () => {
    expect(canonicalValueToHex(0)).not.toBe(canonicalValueToHex(-0));
  });

  test("NaN canonicalizes stably", () => {
    const a = canonicalValueToHex(NaN);
    const b = canonicalValueToHex(Number.NaN);
    expect(a).toBe(b);
  });

  test("array order matters", () => {
    expect(canonicalValueToHex([1, 2, 3])).not.toBe(
      canonicalValueToHex([3, 2, 1]),
    );
  });
});

describe("value_codec binary form basics", () => {
  test("scalar encodings start with distinct tags", () => {
    expect(encodeCanonicalValue(null)[0]).toBe(0x00);
    expect(encodeCanonicalValue(false)[0]).toBe(0x01);
    expect(encodeCanonicalValue(true)[0]).toBe(0x02);
    expect(encodeCanonicalValue(1)[0]).toBe(0x03);
    expect(encodeCanonicalValue("x")[0]).toBe(0x04);
    expect(encodeCanonicalValue([])[0]).toBe(0x05);
    expect(encodeCanonicalValue({})[0]).toBe(0x06);
  });

  test("hex roundtrip", () => {
    const bytes = encodeCanonicalValue({
      a: [1, 2, "x"],
      b: true,
    });
    const hex = bytesToHex(bytes);
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(bytes));
    expect(decodeCanonicalValue(back)).toEqual({
      a: [1, 2, "x"],
      b: true,
    });
  });
});

describe("value_codec rejects unsupported values", () => {
  test("undefined", () => {
    expect(() => encodeCanonicalValue(undefined)).toThrow();
  });

  test("function", () => {
    expect(() => encodeCanonicalValue(() => 1)).toThrow();
  });

  test("Date", () => {
    expect(() => encodeCanonicalValue(new Date())).toThrow();
  });

  test("Map", () => {
    expect(() => encodeCanonicalValue(new Map())).toThrow();
  });
});

describe("value_codec decode validation", () => {
  test("rejects trailing bytes", () => {
    const bytes = encodeCanonicalValue(1);
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes, 0);
    extra[extra.length - 1] = 0xff;
    expect(() => decodeCanonicalValue(extra)).toThrow();
  });

  test("rejects unknown tag", () => {
    expect(() => decodeCanonicalValue(Uint8Array.of(0xff))).toThrow();
  });

  test("rejects truncated number", () => {
    expect(() => decodeCanonicalValue(Uint8Array.of(0x03, 0x00))).toThrow();
  });

  test("rejects truncated string", () => {
    expect(() =>
      decodeCanonicalValue(Uint8Array.of(0x04, 0x00, 0x00, 0x00, 0x02, 0x61)),
    ).toThrow();
  });

  test("rejects truncated array", () => {
    expect(() =>
      decodeCanonicalValue(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x01)),
    ).toThrow();
  });

  test("rejects truncated object", () => {
    expect(() =>
      decodeCanonicalValue(Uint8Array.of(0x06, 0x00, 0x00, 0x00, 0x01)),
    ).toThrow();
  });
});
