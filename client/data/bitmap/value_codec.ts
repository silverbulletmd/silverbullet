const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_OBJECT = 0x06;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type SupportedValue =
  | null
  | boolean
  | number
  | string
  | SupportedValue[]
  | { [key: string]: SupportedValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ensureSupportedValue(value: unknown): asserts value is SupportedValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      ensureSupportedValue(item);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (typeof k !== "string") {
        throw new Error("Only string object keys are supported");
      }
      ensureSupportedValue(v);
    }
    return;
  }
  throw new Error(`Unsupported value type for value codec: ${typeof value}`);
}

// Growable buffer writer — eliminates per-value Uint8Array allocations
class ByteWriter {
  private buf: Uint8Array;
  private pos = 0;

  constructor(initialSize = 64) {
    this.buf = new Uint8Array(initialSize);
  }

  private grow(needed: number): void {
    if (this.pos + needed <= this.buf.length) return;
    const next = new Uint8Array(
      Math.max(this.buf.length * 2, this.pos + needed),
    );
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  writeByte(b: number): void {
    this.grow(1);
    this.buf[this.pos++] = b;
  }

  writeU32BE(n: number): void {
    this.grow(4);
    this.buf[this.pos++] = (n >>> 24) & 0xff;
    this.buf[this.pos++] = (n >>> 16) & 0xff;
    this.buf[this.pos++] = (n >>> 8) & 0xff;
    this.buf[this.pos++] = n & 0xff;
  }

  writeF64BE(n: number): void {
    this.grow(8);
    const view = new DataView(
      this.buf.buffer,
      this.buf.byteOffset + this.pos,
      8,
    );
    if (Number.isNaN(n)) {
      view.setUint32(0, 0x7ff80000, false);
      view.setUint32(4, 0x00000000, false);
    } else {
      view.setFloat64(0, n, false);
    }
    this.pos += 8;
  }

  writeBytes(data: Uint8Array): void {
    this.grow(data.length);
    this.buf.set(data, this.pos);
    this.pos += data.length;
  }

  writeString(value: string): void {
    const data = textEncoder.encode(value);
    this.writeU32BE(data.length);
    this.writeBytes(data);
  }

  finish(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }
}

function encodeValueInto(value: SupportedValue, w: ByteWriter): void {
  if (value === null) {
    w.writeByte(TAG_NULL);
    return;
  }
  if (typeof value === "boolean") {
    w.writeByte(value ? TAG_TRUE : TAG_FALSE);
    return;
  }
  if (typeof value === "number") {
    w.writeByte(TAG_NUMBER);
    w.writeF64BE(Number.isNaN(value) ? NaN : value);
    return;
  }
  if (typeof value === "string") {
    w.writeByte(TAG_STRING);
    w.writeString(value);
    return;
  }
  if (Array.isArray(value)) {
    w.writeByte(TAG_ARRAY);
    w.writeU32BE(value.length);
    for (const item of value) {
      encodeValueInto(item, w);
    }
    return;
  }
  const keys = Object.keys(value).sort();
  w.writeByte(TAG_OBJECT);
  w.writeU32BE(keys.length);
  for (const key of keys) {
    w.writeString(key);
    encodeValueInto(value[key], w);
  }
}

// Decode helpers

function bytesToU32(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getUint32(0, false);
}

function bytesToF64(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getFloat64(0, false);
}

function decodeStringPayload(
  bytes: Uint8Array,
  offset: number,
): { value: string; nextOffset: number } {
  if (offset + 4 > bytes.length) {
    throw new Error("Truncated string length");
  }
  const len = bytesToU32(bytes, offset);
  offset += 4;
  if (offset + len > bytes.length) {
    throw new Error("Truncated string payload");
  }
  const value = textDecoder.decode(bytes.subarray(offset, offset + len));
  return { value, nextOffset: offset + len };
}

function decodeValueInternal(
  bytes: Uint8Array,
  offset: number,
): { value: SupportedValue; nextOffset: number } {
  if (offset >= bytes.length) {
    throw new Error("Unexpected end of input");
  }

  const tag = bytes[offset++];

  switch (tag) {
    case TAG_NULL:
      return { value: null, nextOffset: offset };

    case TAG_FALSE:
      return { value: false, nextOffset: offset };

    case TAG_TRUE:
      return { value: true, nextOffset: offset };

    case TAG_NUMBER: {
      if (offset + 8 > bytes.length) {
        throw new Error("Truncated number payload");
      }
      const value = bytesToF64(bytes, offset);
      return { value, nextOffset: offset + 8 };
    }

    case TAG_STRING: {
      const { value, nextOffset } = decodeStringPayload(bytes, offset);
      return { value, nextOffset };
    }

    case TAG_ARRAY: {
      if (offset + 4 > bytes.length) {
        throw new Error("Truncated array length");
      }
      const count = bytesToU32(bytes, offset);
      offset += 4;
      const arr: SupportedValue[] = [];
      for (let i = 0; i < count; i++) {
        const decoded = decodeValueInternal(bytes, offset);
        arr.push(decoded.value);
        offset = decoded.nextOffset;
      }
      return { value: arr, nextOffset: offset };
    }

    case TAG_OBJECT: {
      if (offset + 4 > bytes.length) {
        throw new Error("Truncated object length");
      }
      const count = bytesToU32(bytes, offset);
      offset += 4;
      const obj: Record<string, SupportedValue> = {};
      for (let i = 0; i < count; i++) {
        const keyDecoded = decodeStringPayload(bytes, offset);
        offset = keyDecoded.nextOffset;
        const valueDecoded = decodeValueInternal(bytes, offset);
        offset = valueDecoded.nextOffset;
        obj[keyDecoded.value] = valueDecoded.value;
      }
      return { value: obj, nextOffset: offset };
    }

    default:
      throw new Error(`Unknown value tag: ${tag}`);
  }
}

// Public API

export function encodeCanonicalValue(value: unknown): Uint8Array {
  ensureSupportedValue(value);
  const w = new ByteWriter(64);
  encodeValueInto(value, w);
  return w.finish();
}

export function decodeCanonicalValue(bytes: Uint8Array): SupportedValue {
  const { value, nextOffset } = decodeValueInternal(bytes, 0);
  if (nextOffset !== bytes.length) {
    throw new Error("Trailing bytes after canonical value");
  }
  return value;
}

export function canonicalValueToHex(value: unknown): string {
  return bytesToHex(encodeCanonicalValue(value));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex digit");
    }
    out[i] = byte;
  }
  return out;
}
