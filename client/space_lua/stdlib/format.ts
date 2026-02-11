// Supported specifiers set: [diuoxXfeEgGcs%]
// Supported flags set: [-+0# ]
// Width and precision via digits or `*`

interface FormatSpec {
  flags: number; // FLAG_*
  width: number;
  hasPrec: boolean;
  prec: number;
  spec: number;
}

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

// pad a string to `width` respecting FLAG_MINUS and FLAG_ZERO
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
  let v = Math.trunc(n);

  let base = 10;
  let unsigned = false;
  let upper = false;

  switch (code) {
    case 100: case 105: // 'd', 'i'
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

  // Alt flag for 'f'/'e' flahs: ensure decimal point exists
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

function formatChar(n: number): string {
  return String.fromCharCode(n & 0x7f);
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
