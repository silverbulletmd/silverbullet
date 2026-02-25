import {
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaRuntimeError,
} from "../runtime.ts";

import { isTaggedFloat } from "../numeric.ts";

function untagN(x: any): number {
  if (typeof x === "number") return x;
  if (isTaggedFloat(x)) return x.value;
  return Number(x);
}

const NATIVE_LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const NATIVE_MAXALIGN = 8; // JS doubles are 8-byte aligned

type KOption =
  | "int"
  | "uint"
  | "float"
  | "double"
  | "number"
  | "char"
  | "string"
  | "zstr"
  | "padding"
  | "paddalign"
  | "nop";

interface ParsedOption {
  opt: KOption;
  size: number; // byte width
  ntoalign: number; // padding bytes before this field
}

interface Header {
  islittle: boolean;
  maxalign: number;
}

function makeHeader(): Header {
  return { islittle: NATIVE_LITTLE, maxalign: NATIVE_MAXALIGN };
}

// Read digits from fmt starting at pos; return [value, newPos]
function readNum(fmt: string, pos: number, dflt: number): [number, number] {
  if (pos >= fmt.length || fmt[pos] < "0" || fmt[pos] > "9") return [dflt, pos];
  let v = 0;
  while (pos < fmt.length && fmt[pos] >= "0" && fmt[pos] <= "9") {
    v = v * 10 + (fmt.charCodeAt(pos) - 48);
    pos++;
  }
  return [v, pos];
}

function numLimit(
  fmt: string,
  pos: number,
  dflt: number,
  src: string,
): [number, number] {
  const [sz, np] = readNum(fmt, pos, dflt);
  if (sz < 1 || sz > 16) {
    throw new Error(`integral size (${sz}) out of limits [1,16] in '${src}'`);
  }
  return [sz, np];
}

// Parse one option from fmt[pos], return [parsed, newPos]
// Modifies header in place for '<', '>', '=', '!'
function getOption(
  fmt: string,
  pos: number,
  h: Header,
): [KOption, number, number] { // [opt, size, newPos]
  const c = fmt[pos++];
  switch (c) {
    case "b":
      return ["int", 1, pos];
    case "B":
      return ["uint", 1, pos];
    case "h":
      return ["int", 2, pos];
    case "H":
      return ["uint", 2, pos];
    case "l":
      return ["int", 8, pos];
    case "L":
      return ["uint", 8, pos];
    case "j":
      return ["int", 8, pos];
    case "J":
      return ["uint", 8, pos];
    case "T":
      return ["uint", 8, pos];
    case "f":
      return ["float", 4, pos];
    case "n":
      return ["number", 8, pos];
    case "d":
      return ["double", 8, pos];
    case "i": {
      const [sz, np] = numLimit(fmt, pos, 4, "i");
      return ["int", sz, np];
    }
    case "I": {
      const [sz, np] = numLimit(fmt, pos, 4, "I");
      return ["uint", sz, np];
    }
    case "s": {
      const [sz, np] = numLimit(fmt, pos, 8, "s");
      return ["string", sz, np];
    }
    case "c": {
      const [sz, np] = readNum(fmt, pos, -1);
      if (sz === -1) throw new Error("missing size for format option 'c'");
      return ["char", sz, np];
    }
    case "z":
      return ["zstr", 0, pos];
    case "x":
      return ["padding", 1, pos];
    case "X":
      return ["paddalign", 0, pos];
    case " ":
      return ["nop", 0, pos];
    case "<":
      h.islittle = true;
      return ["nop", 0, pos];
    case ">":
      h.islittle = false;
      return ["nop", 0, pos];
    case "=":
      h.islittle = NATIVE_LITTLE;
      return ["nop", 0, pos];
    case "!": {
      const [sz, np] = readNum(fmt, pos, NATIVE_MAXALIGN);
      h.maxalign = sz;
      return ["nop", 0, np];
    }
    default:
      throw new Error(`invalid format option '${c}'`);
  }
}

// Compute alignment padding
function getDetails(
  fmt: string,
  pos: number,
  h: Header,
  totalsize: number,
): [ParsedOption, number] {
  let opt: KOption, size: number;
  [opt, size, pos] = getOption(fmt, pos, h);

  let align = size;

  if (opt === "paddalign") {
    if (pos >= fmt.length) {
      throw new Error("invalid next option for option 'X'");
    }
    const hCopy = { ...h };
    let nextOpt: KOption, nextSize: number;
    [nextOpt, nextSize, pos] = getOption(fmt, pos, hCopy);
    if (nextOpt === "char" || nextSize === 0) {
      throw new Error("invalid next option for option 'X'");
    }
    align = nextSize;
  }

  let ntoalign = 0;
  if (
    opt !== "char" && opt !== "nop" && opt !== "padding" && opt !== "paddalign"
  ) {
    const realign = Math.min(align, h.maxalign);
    if (realign > 0) {
      ntoalign = (realign - (totalsize % realign)) % realign;
    }
  }

  return [{ opt, size, ntoalign }, pos];
}

function packInt(v: bigint, size: number, islittle: boolean): Uint8Array {
  const buf = new Uint8Array(size);
  let val = v;
  // Two's complement mask
  const mask = (1n << BigInt(size * 8)) - 1n;
  val = ((val % (mask + 1n)) + (mask + 1n)) & mask; // normalise to unsigned
  for (let i = 0; i < size; i++) {
    buf[islittle ? i : size - 1 - i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return buf;
}

function unpackInt(
  buf: Uint8Array,
  pos: number,
  size: number,
  islittle: boolean,
  issigned: boolean,
): bigint {
  let res = 0n;
  const limit = Math.min(size, 8);
  for (let i = limit - 1; i >= 0; i--) {
    res = (res << 8n) | BigInt(buf[pos + (islittle ? i : size - 1 - i)]);
  }
  if (issigned && size <= 8) {
    const mask = 1n << BigInt(size * 8 - 1);
    if (res & mask) res -= mask << 1n;
  }
  return res;
}

function packFloat32(v: number, islittle: boolean): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, islittle);
  return new Uint8Array(buf);
}

function unpackFloat32(
  buf: Uint8Array,
  pos: number,
  islittle: boolean,
): number {
  return new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(
    0,
    islittle,
  );
}

function packFloat64(v: number, islittle: boolean): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v, islittle);
  return new Uint8Array(buf);
}

function unpackFloat64(
  buf: Uint8Array,
  pos: number,
  islittle: boolean,
): number {
  return new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(
    0,
    islittle,
  );
}

export const strPackFn = new LuaBuiltinFunction(
  (sf, fmt: string, ...args: any[]) => {
    const h = makeHeader();
    const parts: Uint8Array[] = [];
    let totalsize = 0;
    let argIdx = 0;

    let pos = 0;
    while (pos < fmt.length) {
      let opt: ParsedOption;
      [opt, pos] = getDetails(fmt, pos, h, totalsize);

      // alignment padding
      if (opt.ntoalign > 0) {
        parts.push(new Uint8Array(opt.ntoalign));
        totalsize += opt.ntoalign;
      }

      switch (opt.opt) {
        case "nop":
        case "paddalign":
          break;

        case "padding":
          parts.push(new Uint8Array(1)); // LUAL_PACKPADBYTE = 0
          totalsize += 1;
          break;

        case "int":
        case "uint": {
          const v = args[argIdx++];
          if (v === undefined || v === null) {
            throw new LuaRuntimeError(
              `bad argument #${argIdx} to 'pack' (value expected)`,
              sf,
            );
          }
          let bi: bigint;
          if (typeof v === "bigint") bi = v;
          else bi = BigInt(Math.trunc(untagN(v)));
          parts.push(packInt(bi, opt.size, h.islittle));
          totalsize += opt.size;
          break;
        }

        case "float": {
          const v = untagN(args[argIdx++]);
          parts.push(packFloat32(v, h.islittle));
          totalsize += 4;
          break;
        }

        case "double":
        case "number": {
          const v = untagN(args[argIdx++]);
          parts.push(packFloat64(v, h.islittle));
          totalsize += 8;
          break;
        }

        case "char": {
          const s: string = String(args[argIdx++]);
          const enc = new TextEncoder().encode(s);
          const buf = new Uint8Array(opt.size);
          buf.set(enc.subarray(0, opt.size));
          parts.push(buf);
          totalsize += opt.size;
          break;
        }

        case "string": {
          const s: string = String(args[argIdx++]);
          const enc = new TextEncoder().encode(s);
          const lenBuf = packInt(BigInt(enc.length), opt.size, h.islittle);
          parts.push(lenBuf);
          parts.push(enc);
          totalsize += opt.size + enc.length;
          break;
        }

        case "zstr": {
          const s: string = String(args[argIdx++]);
          if (s.includes("\0")) {
            throw new LuaRuntimeError(
              "string contains zeros for format 'z'",
              sf,
            );
          }
          const enc = new TextEncoder().encode(s);
          parts.push(enc);
          parts.push(new Uint8Array(1)); // null terminator
          totalsize += enc.length + 1;
          break;
        }
      }
    }

    // Concatenate all parts into one binary string (latin-1 encoding)
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }

    // Return as a Lua binary string (each byte is a char code 0-255)
    let result = "";
    for (let i = 0; i < out.length; i++) result += String.fromCharCode(out[i]);
    return result;
  },
);

export const strUnpackFn = new LuaBuiltinFunction(
  (sf, fmt: string, data: string, init?: number) => {
    const h = makeHeader();

    const buf = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      buf[i] = data.charCodeAt(i) & 0xff;
    }

    let pos = (init !== undefined && init !== null ? init : 1) - 1;
    const results: any[] = [];

    let fmtPos = 0;
    while (fmtPos < fmt.length) {
      let opt: ParsedOption;
      [opt, fmtPos] = getDetails(fmt, fmtPos, h, pos);

      if (opt.ntoalign + opt.size > buf.length - pos) {
        if (
          opt.opt !== "nop" && opt.opt !== "paddalign" && opt.opt !== "padding"
        ) {
          throw new LuaRuntimeError("data string too short", sf);
        }
      }

      pos += opt.ntoalign; // skip alignment padding

      switch (opt.opt) {
        case "nop":
        case "paddalign":
          break;

        case "padding":
          pos += 1;
          break;

        case "int": {
          const v = unpackInt(buf, pos, opt.size, h.islittle, true);
          const n = Number(v);
          results.push(Number.isSafeInteger(n) ? n : v);
          pos += opt.size;
          break;
        }

        case "uint": {
          const v = unpackInt(buf, pos, opt.size, h.islittle, false);
          const n = Number(v);
          results.push(Number.isSafeInteger(n) ? n : v);
          pos += opt.size;
          break;
        }

        case "float": {
          results.push(unpackFloat32(buf, pos, h.islittle));
          pos += 4;
          break;
        }

        case "double":
        case "number": {
          results.push(unpackFloat64(buf, pos, h.islittle));
          pos += 8;
          break;
        }

        case "char": {
          const s = String.fromCharCode(...buf.subarray(pos, pos + opt.size));
          results.push(s);
          pos += opt.size;
          break;
        }

        case "string": {
          const len = Number(unpackInt(buf, pos, opt.size, h.islittle, false));
          if (len > buf.length - pos - opt.size) {
            throw new LuaRuntimeError("data string too short", sf);
          }
          pos += opt.size;
          const s = new TextDecoder().decode(buf.subarray(pos, pos + len));
          results.push(s);
          pos += len;
          break;
        }

        case "zstr": {
          let end = pos;
          while (end < buf.length && buf[end] !== 0) end++;
          if (end >= buf.length) {
            throw new LuaRuntimeError("unfinished string for format 'z'", sf);
          }
          results.push(new TextDecoder().decode(buf.subarray(pos, end)));
          pos = end + 1;
          break;
        }
      }
    }

    results.push(pos + 1);
    return new LuaMultiRes(results);
  },
);

export const strPackSizeFn = new LuaBuiltinFunction(
  (_sf, fmt: string) => {
    const h = makeHeader();
    let totalsize = 0;
    let pos = 0;

    while (pos < fmt.length) {
      let opt: ParsedOption;
      [opt, pos] = getDetails(fmt, pos, h, totalsize);

      if (opt.opt === "string" || opt.opt === "zstr") {
        throw new LuaRuntimeError("variable-length format", _sf);
      }

      totalsize += opt.ntoalign + opt.size;
    }

    return totalsize;
  },
);
