/**
 * Space Lua `tonumber` implementation
 *
 * Matches Lua 5.4 semantics:
 * - parses decimal or hex numerals
 * - if base is given parses signed integers in the given base (2..36)
 * - leading and trailing Lua spaces are trimmed (`\t\r\n\h\v`)
 * - returns null on failure
 *
 * Notes:
 * - hex without exponent is an integer
 * - hex float requires `p` or `P` exponent
 * - decimal float allows '.' and `e` or `E` exponent
 */
import type { NumericType } from "./ast.ts";

function skipSpace(s: string, i: number): number {
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) { // SP, HT, LF, VT, FF, CR
      i++;
    } else {
      break;
    }
  }
  return i;
}

function charToDigitBase(c: number, base: number): number {
  if (c >= 48 && c <= 57) { // '0'..'9'
    const v = c - 48;
    if (v < base) {
      return v;
    } else {
      return -1;
    }
  } else if (c >= 65 && c <= 90) { // 'A'..'Z'
    const v = 10 + (c - 65);
    if (v < base) {
      return v;
    } else {
      return -1;
    }
  } else if (c >= 97 && c <= 122) { // 'a'..'z'
    const v = 10 + (c - 97);
    if (v < base) {
      return v;
    } else {
      return -1;
    }
  } else {
    return -1;
  }
}

function parseIntWithBase(
  s: string,
  base: number,
): { ok: boolean; end: number; value: number } {
  const n = s.length;
  let i = 0;
  i = skipSpace(s, i);
  if (i >= n) {
    return { ok: false, end: i, value: 0 };
  }

  let sign = 1;
  if (s.charCodeAt(i) === 45) { // '-'
    sign = -1;
    i++;
  } else if (s.charCodeAt(i) === 43) { // '+'
    i++;
  }

  if (i >= n) {
    return { ok: false, end: i, value: 0 };
  }

  let acc = 0;
  let any = false;

  while (i < n) {
    const c = s.charCodeAt(i);
    const isAlnum = (c >= 48 && c <= 57) || // '0'..'9'
      (c >= 65 && c <= 90) || // 'A'..'Z'
      (c >= 97 && c <= 122); // 'a'..'z'

    if (!isAlnum) {
      break;
    }

    const d = charToDigitBase(c, base);
    if (d < 0) {
      return { ok: false, end: i, value: 0 };
    }

    acc = acc * base + d;
    any = true;
    i++;
  }

  if (!any) {
    return { ok: false, end: i, value: 0 };
  }

  i = skipSpace(s, i);
  if (i !== n) {
    return { ok: false, end: i, value: 0 };
  }

  return { ok: true, end: i, value: sign * acc };
}

function parseInt(s: string): { ok: boolean; value: number } {
  const n = s.length;
  let i = 0;
  i = skipSpace(s, i);
  if (i >= n) {
    return { ok: false, value: 0 };
  }

  let neg = false;
  if (s.charCodeAt(i) === 45) { // '-'
    neg = true;
    i++;
  } else if (s.charCodeAt(i) === 43) { // '+'
    i++;
  }

  if (i >= n) {
    return { ok: false, value: 0 };
  }

  let acc = 0;
  let any = false;

  // hex?
  if (s.charCodeAt(i) === 48 && i + 1 < n) { // '0'
    const x = s.charCodeAt(i + 1);
    if (x === 120 || x === 88) { // 'x' or 'X'
      i += 2;
      while (i < n) {
        const c = s.charCodeAt(i);
        let d = -1;
        if (c >= 48 && c <= 57) { // '0'..'9'
          d = c - 48; // '0'
        } else if (c >= 65 && c <= 70) { // 'A'..'F'
          d = 10 + (c - 65);
        } else if (c >= 97 && c <= 102) { // 'a'..'f'
          d = 10 + (c - 97);
        } else {
          d = -1;
        }
        if (d < 0) {
          break;
        }
        acc = acc * 16 + d;
        any = true;
        i++;
      }
      i = skipSpace(s, i);
      if (!any || i !== n) {
        return { ok: false, value: 0 };
      } else {
        return { ok: true, value: neg ? -acc : acc };
      }
    }
  }

  // decimal integer
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) { // not '0'..'9'
      break;
    }
    acc = acc * 10 + (c - 48);
    any = true;
    i++;
  }

  i = skipSpace(s, i);
  if (!any || i !== n) {
    return { ok: false, value: 0 };
  } else {
    return { ok: true, value: neg ? -acc : acc };
  }
}

function parseDecFloat(s: string): { ok: boolean; value: number } {
  const n = s.length;
  let i = 0;
  i = skipSpace(s, i);
  if (i >= n) {
    return { ok: false, value: 0 };
  }

  let sign = 1;
  const c0 = s.charCodeAt(i);
  if (c0 === 45) { // '-'
    sign = -1;
    i++;
  } else if (c0 === 43) { // '+'
    i++;
  }

  let intAny = false;
  let fracAny = false;
  let val = 0;

  // integer part
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) { // not '0'..'9'
      break;
    }
    val = val * 10 + (c - 48);
    intAny = true;
    i++;
  }

  // fractional part
  if (i < n) {
    if (s.charCodeAt(i) === 46) { // '.'
      i++;
      let scale = 1;
      while (i < n) {
        const c = s.charCodeAt(i);
        if (c < 48 || c > 57) { // not '0'..'9'
          break;
        }
        scale *= 0.1;
        val += (c - 48) * scale;
        fracAny = true;
        i++;
      }
    }
  }

  // exponent
  let exp = 0;
  let hasExp = false;
  if (i < n) {
    const ec = s.charCodeAt(i);
    if (ec === 101 || ec === 69) { // 'e' or 'E'
      hasExp = true;
      i++;
      if (i >= n) {
        return { ok: false, value: 0 };
      }
      let expSign = 1;
      if (i < n) {
        const es = s.charCodeAt(i);
        if (es === 45) { // '-'
          expSign = -1;
          i++;
        } else if (es === 43) { // '+'
          i++;
        }
      }
      if (i >= n) {
        return { ok: false, value: 0 };
      }
      let anyExp = false;
      while (i < n) {
        const c = s.charCodeAt(i);
        if (c < 48 || c > 57) { // not '0'..'9'
          break;
        }
        exp = exp * 10 + (c - 48);
        anyExp = true;
        i++;
      }
      if (!anyExp) {
        return { ok: false, value: 0 };
      }
      exp *= expSign;
    }
  }

  if (!intAny && !fracAny) {
    return { ok: false, value: 0 };
  }

  i = skipSpace(s, i);
  if (i !== n) {
    return { ok: false, value: 0 };
  }

  const result = sign * (hasExp ? val * Math.pow(10, exp) : val);
  return { ok: true, value: result };
}

function parseHexFloat(s: string): { ok: boolean; value: number } {
  const n = s.length;
  let i = 0;
  i = skipSpace(s, i);
  if (i >= n) {
    return { ok: false, value: 0 };
  }

  let sign = 1;
  const c0 = s.charCodeAt(i);
  if (c0 === 45) { // '-'
    sign = -1;
    i++;
  } else if (c0 === 43) { // '+'
    i++;
  }

  if (!(i + 1 < n && s.charCodeAt(i) === 48)) { // '0'
    return { ok: false, value: 0 };
  }
  const x = s.charCodeAt(i + 1);
  if (!(x === 120 || x === 88)) { // 'x' or 'X'
    return { ok: false, value: 0 };
  }
  i += 2;

  let intVal = 0;
  let fracVal = 0;
  let fracScale = 1;
  let anyHex = false;
  let sawDot = false;

  // integer hex digits
  while (i < n) {
    const c = s.charCodeAt(i);
    let d = -1;
    if (c >= 48 && c <= 57) { // '0'..'9'
      d = c - 48;
    } else if (c >= 65 && c <= 70) { // 'A'..'F'
      d = 10 + (c - 65);
    } else if (c >= 97 && c <= 102) { // 'a'..'f'
      d = 10 + (c - 97);
    } else {
      d = -1;
    }
    if (d < 0) {
      break;
    }
    intVal = intVal * 16 + d;
    anyHex = true;
    i++;
  }

  // optional fractional part
  if (i < n) {
    if (s.charCodeAt(i) === 46) { // '.'
      sawDot = true;
      i++;
      while (i < n) {
        const c = s.charCodeAt(i);
        let d = -1;
        if (c >= 48 && c <= 57) { // '0'..'9'
          d = c - 48;
        } else if (c >= 65 && c <= 70) { // 'A'..'F'
          d = 10 + (c - 65);
        } else if (c >= 97 && c <= 102) { // 'a'..'f'
          d = 10 + (c - 97);
        } else {
          d = -1;
        }
        if (d < 0) {
          break;
        }
        fracScale *= 16;
        fracVal = fracVal * 16 + d;
        anyHex = true;
        i++;
      }
    }
  }

  // exponent:
  // - required if there is no dot (so `0x10` stays an integer),
  // - optional if there was a dot (`0x1.2` means `0x1.2p0`).
  let expSign = 1;
  let exp = 0;

  if (i < n) {
    const ec = s.charCodeAt(i);
    if (ec === 112 || ec === 80) { // 'p' or 'P'
      i++;
      if (i < n) {
        const sc = s.charCodeAt(i);
        if (sc === 45) { // '-'
          expSign = -1;
          i++;
        } else if (sc === 43) { // '+'
          i++;
        }
      }
      if (i >= n) {
        return { ok: false, value: 0 };
      }

      let anyExp = false;
      while (i < n) {
        const c = s.charCodeAt(i);
        if (c < 48 || c > 57) { // not '0'..'9'
          break;
        }
        exp = exp * 10 + (c - 48);
        anyExp = true;
        i++;
      }
      if (!anyHex || !anyExp) {
        return { ok: false, value: 0 };
      }
    } else {
      // no exponent marker
      if (!sawDot) {
        // without dot we must reject so parseInt can claim it as integer
        return { ok: false, value: 0 };
      }
      if (!anyHex) {
        return { ok: false, value: 0 };
      }
      expSign = 1;
      exp = 0; // implicit p0
    }
  } else {
    // end of string
    if (!sawDot) {
      return { ok: false, value: 0 };
    }
    if (!anyHex) {
      return { ok: false, value: 0 };
    }
    expSign = 1;
    exp = 0;
  }

  i = skipSpace(s, i);
  if (i !== n) {
    return { ok: false, value: 0 };
  }

  const frac = fracVal === 0 ? 0 : (fracVal / fracScale);
  const result = sign * (intVal + frac) * Math.pow(2, expSign * exp);
  return { ok: true, value: result };
}

// Detailed string conversion that returns numeric type, returns null
// on failure, integer -0 is canonicalized to +0
export function luaToNumberDetailed(
  s: string,
  base?: number,
): { value: number; numericType: NumericType } | null {
  if (base !== undefined) {
    // Base range errors are handled by the stdlib `tonumber` builtin,
    // to match Lua's "bad argument #2 ..." error message.
    if (!(typeof base === "number" && base >= 2 && base <= 36)) {
      return null;
    }

    const parsed = parseIntWithBase(s, base);
    if (parsed.ok) {
      const v = parsed.value;
      return { value: v === 0 ? 0 : v, numericType: "int" };
    } else {
      return null;
    }
  }

  {
    const parsed = parseInt(s);
    if (parsed.ok) {
      const v = parsed.value;
      return { value: v === 0 ? 0 : v, numericType: "int" };
    }
  }

  {
    const parsed = parseHexFloat(s);
    if (parsed.ok) {
      return { value: parsed.value, numericType: "float" };
    }
  }

  {
    const parsed = parseDecFloat(s);
    if (parsed.ok) {
      return { value: parsed.value, numericType: "float" };
    }
  }

  return null;
}

// Space Lua `tonumber` returning only the numeric value or null
export function luaToNumber(s: unknown, base?: number): number | null {
  if (typeof s === "number") {
    return s;
  }
  if (s instanceof Number) {
    return Number(s);
  }
  if (typeof s !== "string") {
    return null;
  }
  const detailed = luaToNumberDetailed(s, base);
  return detailed ? detailed.value : null;
}