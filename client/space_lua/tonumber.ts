/**
 * Lua-compatible toNumber(s, [base])
 *
 * Supports decimal and heximal numbers (including floats) and base 2-36
 * conversion.
 *
 * Returns null if conversion fails.
 */
export function toNumber(s: string, base?: number): number | null {
  if (typeof s !== 'string') return null;
  s = s.trim();
  if (s === '') return null;
  if (base === undefined) {
    // Heximal
    const hexMatch = s.match(/^([-+])?0[xX]([0-9a-fA-F]+)(?:\.([0-9a-fA-F]*))?(?:[pP]([-+]?\d+))?$/);
    if (hexMatch) {
      const sign = hexMatch[1] === '-' ? -1 : 1;
      const intPart = parseInt(hexMatch[2], 16);
      let fracPart = 0;
      if (hexMatch[3] && hexMatch[3].length > 0) {
        fracPart = parseInt(hexMatch[3], 16) / Math.pow(16, hexMatch[3].length);
      }
      const exponent = hexMatch[4] ? parseInt(hexMatch[4], 10) : 0;
      let result = sign * (intPart + fracPart) * Math.pow(2, exponent);
      if (!hexMatch[3] && !hexMatch[4]) {
        result = sign * intPart;
      }
      return isFinite(result) ? result : null;
    }
    // Decimal
    const num = Number(s);
    return isNaN(num) ? null : num;
  }
  // Base 2-36
  if (typeof base === 'number' && base >= 2 && base <= 36) {
    let i = 0, len = s.length, sign = 1;
    if (len > 0 && (s[0] === '-' || s[0] === '+')) {
      sign = s[0] === '-' ? -1 : 1;
      i++;
    }
    if (i === len) return null; // only sign, no digits

    let result = 0;
    for (; i < len; ++i) {
      const c = s[i];
      let digit: number;
      if (c >= '0' && c <= '9') digit = c.charCodeAt(0) - 48;
      else if (c >= 'a' && c <= 'z') digit = c.charCodeAt(0) - 87;
      else if (c >= 'A' && c <= 'Z') digit = c.charCodeAt(0) - 55;
      else return null;
      if (digit >= base) return null;
      result = result * base + digit;
    }
    return isFinite(result) ? sign * result : null;
  }
  return null;
}
