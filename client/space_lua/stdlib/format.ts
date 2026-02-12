// Supported specifiers set: [diuoxXaAfeEgGcspq%]
// Supported flags set: [-+0# ]
// Width and precision via digits or `*`

type FormatSpec = {
  flags: number; // FLAG_*
  width: number;
  hasPrec: boolean;
  prec: number;
  spec: number;
};

const FLAG_MINUS = 1;
const FLAG_PLUS = 2;
const FLAG_ZERO = 4;
const FLAG_HASH = 8;
const FLAG_SPACE = 16;

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57; // '0'..'9'
}

// Parse a format spec starting after '%' and return index of specifier.
function parseSpec(
  fmt: string,
  start: number,
): { spec: FormatSpec; end: number } {
  let i = start;
  const len = fmt.length;
  let flags = 0;

  outer: while (i < len) {
    switch (fmt.charCodeAt(i)) {
      case 45:
        flags |= FLAG_MINUS;
        i++;
        break; // '-'
      case 43:
        flags |= FLAG_PLUS;
        i++;
        break; // '+'
      case 48:
        flags |= FLAG_ZERO;
        i++;
        break; // '0'
      case 35:
        flags |= FLAG_HASH;
        i++;
        break; // '#'
      case 32:
        flags |= FLAG_SPACE;
        i++;
        break; // ' '
      default:
        break outer;
    }
  }

  // Parse width
  let width = 0;
  if (i < len && fmt.charCodeAt(i) === 42) { // '*'
    width = -1;
    i++;
  } else {
    while (i < len && isDigit(fmt.charCodeAt(i))) {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
  }

  // Parse precision
  let hasPrec = false;
  let prec = 0;
  if (i < len && fmt.charCodeAt(i) === 46) { // '.'
    hasPrec = true;
    i++;
    if (i < len && fmt.charCodeAt(i) === 42) { // '*'
      prec = -1;
      i++;
    } else {
      while (i < len && isDigit(fmt.charCodeAt(i))) {
        prec = prec * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
  }

  // Skip length modifiers [hlL] ignored in Lua
  while (
    i < len &&
    (fmt.charCodeAt(i) === 104 || // 'h'
      fmt.charCodeAt(i) === 108 || // 'l'
      fmt.charCodeAt(i) === 76) // 'L'
  ) {
    i++;
  }

  if (i >= len) {
    throw new Error("invalid format (missing specifier)");
  }

  return {
    spec: { flags, width, hasPrec, prec, spec: fmt.charCodeAt(i) },
    end: i,
  };
}

// pad a string to `width` respecting `FLAG_MINUS` and `FLAG_ZERO`
function pad(s: string, width: number, flags: number, numPad: boolean): string {
  if (width <= 0 || s.length >= width) return s;
  const n = width - s.length;
  if (numPad && (flags & FLAG_ZERO) && !(flags & FLAG_MINUS)) {
    let signLen = 0;
    if (s.charCodeAt(0) === 45 || s.charCodeAt(0) === 43) { // '-' or '+'
      signLen = 1;
    } else if (
      s.charCodeAt(0) === 48 &&
      (s.charCodeAt(1) === 120 || s.charCodeAt(1) === 88)
    ) {
      signLen = 2; // '0x' or '0X'
    }
    return s.slice(0, signLen) + "0".repeat(n) + s.slice(signLen);
  }
  if (flags & FLAG_MINUS) {
    return s + " ".repeat(n);
  }
  return " ".repeat(n) + s;
}

function addSign(s: string, flags: number): string {
  if (flags & FLAG_PLUS) return "+" + s;
  if (flags & FLAG_SPACE) return " " + s;
  return s;
}

function formatInt(n: number, spec: FormatSpec): string {
  const code = spec.spec;
  const v = Math.trunc(n);

  let base = 10;
  let unsigned = false;
  let upper = false;

  switch (code) {
    case 100:
    case 105: // 'd', 'i'
      break;
    case 117: // 'u'
      unsigned = true;
      break;
    case 111: // 'o'
      base = 8;
      unsigned = true;
      break;
    case 120: // 'x'
      base = 16;
      unsigned = true;
      break;
    case 88: // 'X'
      base = 16;
      unsigned = true;
      upper = true;
      break;
  }

  let neg = false;
  let digits: string;

  if (unsigned && v < 0) {
    // Reinterpret as 64-bit unsigned
    const bv = BigInt(v) + (1n << 64n);
    digits = bv.toString(base);
  } else if (unsigned) {
    digits = v.toString(base);
  } else {
    neg = v < 0;
    digits = (neg ? -v : v).toString(base);
  }

  if (upper) digits = digits.toUpperCase();

  // Precision
  if (spec.hasPrec) {
    if (spec.prec === 0 && v === 0) {
      digits = "";
    } else if (digits.length < spec.prec) {
      digits = "0".repeat(spec.prec - digits.length) + digits;
    }
  }

  // Alt flag
  let prefix = "";
  if (spec.flags & FLAG_HASH) {
    if (base === 8 && (digits.length === 0 || digits.charCodeAt(0) !== 48)) {
      prefix = "0";
    } else if (base === 16 && v !== 0) {
      prefix = upper ? "0X" : "0x";
    }
  }

  let result: string;
  if (neg) {
    result = "-" + prefix + digits;
  } else {
    result = addSign(prefix + digits, spec.flags);
  }

  const numPad = !spec.hasPrec;
  return pad(result, spec.width, spec.flags, numPad);
}

function formatFloat(n: number, spec: FormatSpec): string {
  const code = spec.spec;
  const upper = code === 69 || code === 71 || code === 70;
  // 'E'=69 'G'=71 'F'=70 'e'=101 'g'=103 'f'=102
  const lower = code | 32; // to lowercase

  // Lua convention
  if (!isFinite(n)) {
    let s: string;
    if (n !== n) {
      s = upper ? "-NAN" : "-nan";
    } else if (n > 0) {
      s = upper ? "INF" : "inf";
      s = addSign(s, spec.flags);
    } else {
      s = upper ? "-INF" : "-inf";
    }
    return pad(s, spec.width, spec.flags, false);
  }

  const neg = n < 0 || (n === 0 && 1 / n === -Infinity);
  const abs = neg ? -n : n;
  const prec = spec.hasPrec ? spec.prec : 6;

  let body: string;

  if (lower === 102) { // 'f'
    body = abs.toFixed(prec);
  } else if (lower === 101) { // 'e'
    body = abs.toExponential(prec);
    // Ensure exponent has at least 2 digits
    body = ensureExpTwoDigits(body);
  } else { // 'g'
    const gPrec = (prec === 0) ? 1 : prec;
    if (abs === 0) {
      body = "0";
    } else {
      // C rule: use 'e' if exponent < -4 or exponent >= precision
      const exp = Math.floor(Math.log10(abs));
      if (exp < -4 || exp >= gPrec) {
        body = abs.toExponential(gPrec - 1);
        body = ensureExpTwoDigits(body);
      } else {
        // Number of decimals = precision - (exponent + 1)
        const decimals = gPrec - (exp + 1);
        body = abs.toFixed(decimals);
      }
    }
    // Strip trailing zeros unless '#' flag
    if (!(spec.flags & FLAG_HASH)) {
      body = stripTrailingZerosG(body);
    }
  }

  if (upper) {
    body = body.toUpperCase();
  }

  // Alt flag for 'f'/'e': ensure decimal point exists
  if ((spec.flags & FLAG_HASH) && lower !== 103) {
    if (body.indexOf(".") === -1) {
      // Insert dot before 'e' if present, else append
      const eIdx = body.indexOf("e");
      const EIdx = body.indexOf("E");
      const expIdx = eIdx !== -1 ? eIdx : EIdx;
      if (expIdx !== -1) {
        body = body.slice(0, expIdx) + "." + body.slice(expIdx);
      } else {
        body = body + ".";
      }
    }
  }

  // Alt flag for 'g': keep trailing zeros but ensure decimal point
  if ((spec.flags & FLAG_HASH) && lower === 103) {
    if (body.indexOf(".") === -1) {
      const expIdx = findExpIndex(body);
      if (expIdx !== -1) {
        body = body.slice(0, expIdx) + "." + body.slice(expIdx);
      } else {
        body = body + ".";
      }
    }
  }

  let result: string;
  if (neg) {
    result = "-" + body;
  } else {
    result = addSign(body, spec.flags);
  }

  return pad(result, spec.width, spec.flags, true);
}

function findExpIndex(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 101 || c === 69) return i; // 'e' or 'E'
  }
  return -1;
}

// Ensure exponent part has at least 2 digits
function ensureExpTwoDigits(s: string): string {
  const idx = findExpIndex(s);
  if (idx === -1) return s;
  // idx+1 is sign, idx+2... are digits
  const signIdx = idx + 1;
  if (signIdx >= s.length) return s;
  const digitStart = signIdx + 1;
  const expLen = s.length - digitStart;
  if (expLen < 2) {
    return s.slice(0, digitStart) + "0" + s.slice(digitStart);
  }
  return s;
}

// Strip trailing zeros from '%g' output
function stripTrailingZerosG(s: string): string {
  const expIdx = findExpIndex(s);
  const mantissa = expIdx !== -1 ? s.slice(0, expIdx) : s;
  const exp = expIdx !== -1 ? s.slice(expIdx) : "";

  const dotIdx = mantissa.indexOf(".");
  if (dotIdx === -1) return s; // nothing to strip

  let end = mantissa.length;
  while (end > dotIdx + 1 && mantissa.charCodeAt(end - 1) === 48) { // '0'
    end--;
  }
  // Remove dot if nothing after it
  if (end === dotIdx + 1) {
    end = dotIdx;
  }

  return mantissa.slice(0, end) + exp;
}

// Format a number as hexadecimal floating-point (%a/%A)
function formatHexFloat(n: number, spec: FormatSpec): string {
  const code = spec.spec;
  const upper = code === 65; // 'A'

  if (!isFinite(n)) {
    let s: string;
    if (n !== n) {
      s = upper ? "-NAN" : "-nan";
    } else if (n > 0) {
      s = upper ? "INF" : "inf";
      s = addSign(s, spec.flags);
    } else {
      s = upper ? "-INF" : "-inf";
    }
    return pad(s, spec.width, spec.flags, false);
  }

  const neg = n < 0 || (n === 0 && 1 / n === -Infinity);
  const abs = neg ? -n : n;

  let body: string;
  if (abs === 0) {
    const prec = spec.hasPrec ? spec.prec : 0;
    if (prec > 0) {
      body = "0x0." + "0".repeat(prec) + "p+0";
    } else {
      body = "0x0p+0";
    }
  } else {
    body = hexFloatBody(abs, spec);
  }

  if (upper) body = body.toUpperCase();

  // Alt flag: ensure decimal point
  if (spec.flags & FLAG_HASH) {
    const pIdx = findPIndex(body);
    if (pIdx !== -1) {
      let hasDot = false;
      for (let k = 0; k < pIdx; k++) {
        if (body.charCodeAt(k) === 46) { // '.'
          hasDot = true;
          break;
        }
      }
      if (!hasDot) {
        body = body.slice(0, pIdx) + "." + body.slice(pIdx);
      }
    }
  }

  let result: string;
  if (neg) {
    result = "-" + body;
  } else {
    result = addSign(body, spec.flags);
  }

  return pad(result, spec.width, spec.flags, true);
}

// Find index of 'p' or 'P' in hex float string
function findPIndex(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 112 || c === 80) return i; // 'p' or 'P'
  }
  return -1;
}

// Number of bits needed to represent a positive bigint
function bitLength(n: bigint): number {
  let bits = 0;
  let v = n;
  while (v > 0n) {
    bits++;
    v >>= 1n;
  }
  return bits;
}

// Decompose a positive non-zero finite float into `0xH.HHHpN` form
function hexFloatBody(abs: number, spec: FormatSpec): string {
  const buf = new Float64Array(1);
  const view = new DataView(buf.buffer);
  view.setFloat64(0, abs);
  const bits = view.getBigUint64(0);
  const biasedExp = Number((bits >> 52n) & 0x7FFn);
  const frac = bits & 0xFFFFFFFFFFFFFn;

  let exponent: number;
  let mantBits: bigint;

  if (biasedExp === 0) {
    // Subnormal
    if (frac === 0n) return "0x0p+0";
    const shift = 52 - bitLength(frac) + 1;
    mantBits = frac << BigInt(shift);
    exponent = -1022 - shift;
  } else {
    // Normal
    exponent = biasedExp - 1023;
    mantBits = frac | (1n << 52n);
  }

  let firstDigit = Number(mantBits >> 52n);
  const restBits = mantBits & ((1n << 52n) - 1n);

  // 13 hex digits from 52 bits
  let fracHex = hexDigits52(restBits);

  if (spec.hasPrec) {
    if (spec.prec < 13) {
      const carry = roundHexInPlace(fracHex, spec.prec);
      if (carry) firstDigit++;
      fracHex = truncHexDigits(fracHex, spec.prec);
    } else {
      fracHex = padHexRight(fracHex, spec.prec);
    }
  } else {
    fracHex = stripHexTrailingZeros(fracHex);
  }

  const expSign = exponent >= 0 ? "+" : "";
  if (fracHex.length > 0) {
    return "0x" + firstDigit + "." + fracHex + "p" + expSign + exponent;
  }
  return "0x" + firstDigit + "p" + expSign + exponent;
}

// Convert 52-bit value to 13 hex digits, zero-padded
function hexDigits52(bits: bigint): string {
  const s = bits.toString(16);
  if (s.length >= 13) return s;
  return "0".repeat(13 - s.length) + s;
}

// Parse one hex char to its numeric value
function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48; // '0'..'9'
  if (c >= 97 && c <= 102) return c - 87; // 'a'..'f'
  if (c >= 65 && c <= 70) return c - 55; // 'A'..'F'
  return 0;
}

function roundHexInPlace(digits: string, prec: number): boolean {
  if (prec >= digits.length) return false;

  const nextVal = hexVal(digits.charCodeAt(prec));
  if (nextVal < 8) return false;

  if (prec === 0) return true;

  const arr = new Array<number>(prec);
  for (let i = 0; i < prec; i++) {
    arr[i] = hexVal(digits.charCodeAt(i));
  }

  let carry = 1;
  for (let i = prec - 1; i >= 0 && carry; i--) {
    arr[i] += carry;
    if (arr[i] >= 16) {
      arr[i] = 0;
      carry = 1;
    } else {
      carry = 0;
    }
  }

  return carry === 1;
}

function truncHexDigits(digits: string, prec: number): string {
  if (prec === 0) return "";

  const nextVal = hexVal(digits.charCodeAt(prec));
  if (nextVal < 8) return digits.slice(0, prec);

  const arr = new Array<number>(prec);
  for (let i = 0; i < prec; i++) {
    arr[i] = hexVal(digits.charCodeAt(i));
  }

  let carry = 1;
  for (let i = prec - 1; i >= 0 && carry; i--) {
    arr[i] += carry;
    if (arr[i] >= 16) {
      arr[i] = 0;
    } else {
      carry = 0;
    }
  }

  let out = "";
  for (let i = 0; i < prec; i++) {
    out += arr[i].toString(16);
  }

  return out;
}

function padHexRight(s: string, len: number): string {
  if (s.length >= len) return s;
  return s + "0".repeat(len - s.length);
}

function stripHexTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 48) { // '0'
    end--;
  }
  if (end === s.length) return s;
  return s.slice(0, end);
}

function quoteString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 92 || c === 10) {
      // '"', '\\', '\n': backslash + literal char
      out += "\\";
      out += String.fromCharCode(c);
    } else if (c < 32) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      const isNextDigit = next >= 48 && next <= 57;
      if (isNextDigit) {
        const ds = c.toString();
        out += "\\";
        if (ds.length < 3) out += "0".repeat(3 - ds.length);
        out += ds;
      } else {
        out += "\\" + c.toString();
      }
    } else {
      out += String.fromCharCode(c);
    }
  }
  out += '"';
  return out;
}

// Format a float for %q: hex representation preserving full precision
function quoteFloat(n: number): string {
  if (n !== n) return "(0/0)";
  if (n === Infinity) return "1e9999";
  if (n === -Infinity) return "-1e9999";

  const spec: FormatSpec = {
    flags: 0,
    width: 0,
    hasPrec: false,
    prec: 0,
    spec: 97, // 'a'
  };
  return formatHexFloat(n, spec);
}

function formatQ(v: unknown): string {
  if (v === null || v === undefined) return "nil";
  if (v === true) return "true";
  if (v === false) return "false";

  if (typeof v === "number") {
    if (v === 0 && 1 / v === -Infinity) return quoteFloat(v);
    if (Number.isInteger(v) && Number.isFinite(v)) {
      return v.toString();
    }
    return quoteFloat(v);
  }

  return quoteString(String(v));
}

function formatChar(n: number): string {
  return String.fromCharCode(n & 0x7f);
}

const objectIds = new WeakMap<WeakKey, number>();
const stringIds = new Map<string, number>();
let nextId = 1;

function toPointer(v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "boolean" || typeof v === "number") return "(null)";

  // Primitives (strings, symbols, etc.) cannot be `WeakMap` keys
  if (typeof v !== "object" && typeof v !== "function") {
    const key = String(v);
    let id = stringIds.get(key);
    if (id === undefined) {
      id = nextId++;
      stringIds.set(key, id);
    }
    return "0x" + id.toString(16).padStart(14, "0");
  }

  const obj = v as object;
  let id = objectIds.get(obj);
  if (id === undefined) {
    id = nextId++;
    objectIds.set(obj, id);
  }
  return "0x" + id.toString(16).padStart(14, "0");
}

function formatPointer(v: unknown, spec: FormatSpec): string {
  const s = toPointer(v);
  // `%p` only supports width and '-' flag, no precision
  return pad(s, spec.width, spec.flags, false);
}

export function luaFormat(fmt: string, ...args: any[]): string {
  let out = "";
  let ai = 0; // arg index
  const len = fmt.length;
  let i = 0;

  while (i < len) {
    const c = fmt.charCodeAt(i);
    if (c !== 37) { // not '%'
      // Fast path: scan for next '%' or end
      let j = i + 1;
      while (j < len && fmt.charCodeAt(j) !== 37) j++;
      out += fmt.slice(i, j);
      i = j;
      continue;
    }

    // '%' found
    i++;
    if (i >= len) {
      throw new Error("invalid format (ends with '%')");
    }

    // '%%' into literal '%'
    if (fmt.charCodeAt(i) === 37) {
      out += "%";
      i++;
      continue;
    }

    const { spec, end } = parseSpec(fmt, i);
    i = end + 1;

    // Resolve `*` width and precision from args
    let width = spec.width;
    if (width === -1) {
      width = Number(args[ai++]) || 0;
      if (width < 0) {
        spec.flags |= FLAG_MINUS;
        width = -width;
      }
      spec.width = width;
    }
    if (spec.prec === -1) {
      let p = Number(args[ai++]) || 0;
      if (p < 0) {
        spec.hasPrec = false;
        p = 0;
      }
      spec.prec = p;
    }

    const code = spec.spec;
    switch (code) {
      case 97:
      case 65: // 'a', 'A'
        out += formatHexFloat(Number(args[ai++]), spec);
        break;
      case 100:
      case 105:
      case 117: // 'd', 'i', 'u'
      case 111:
      case 120:
      case 88: // 'o', 'x', 'X'
        out += formatInt(Number(args[ai++]), spec);
        break;
      case 102:
      case 101:
      case 69: // 'f', 'e', 'E'
      case 103:
      case 71:
      case 70: // 'g', 'G', 'F'
        out += formatFloat(Number(args[ai++]), spec);
        break;
      case 99: // 'c'
        out += pad(
          formatChar(Number(args[ai++])),
          spec.width,
          spec.flags,
          false,
        );
        break;
      case 112: { // 'p'
        out += formatPointer(args[ai++], spec);
        break;
      }
      case 113: { // 'q'
        out += formatQ(args[ai++]);
        break;
      }
      case 115: { // 's'
        let s = String(args[ai++]);
        if (spec.hasPrec && s.length > spec.prec) {
          s = s.slice(0, spec.prec);
        }
        out += pad(s, spec.width, spec.flags, false);
        break;
      }
      default:
        throw new Error(
          `invalid format specifier '${String.fromCharCode(code)}'`,
        );
    }
  }

  return out;
}
