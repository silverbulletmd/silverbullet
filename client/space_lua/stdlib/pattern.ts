// Lua Optimized Pattern Matching Engine Implementation

const CH_ESC = 37; // '%'
const CH_OPEN = 40; // '('
const CH_CLOSE = 41; // ')'
const CH_DOT = 46; // '.'
const CH_DOLLAR = 36; // '$'
const CH_LBRACKET = 91; // '['
const CH_RBRACKET = 93; // ']'
const CH_CARET = 94; // '^'
const CH_DASH = 45; // '-'
const CH_STAR = 42; // '*'
const CH_PLUS = 43; // '+'
const CH_QUESTION = 63; // '?'
const CH_0 = 48; // '0'
const CH_9 = 57; // '9'

const SPECIALS_SET = new Set<number>([
  CH_CARET,
  CH_DOLLAR,
  CH_STAR,
  CH_PLUS,
  CH_QUESTION,
  CH_DOT,
  CH_OPEN,
  CH_LBRACKET,
  CH_ESC,
  CH_DASH,
]);

const MAX_CAPTURES = 32;
const MAX_MATCH_DEPTH = 200;

const CAP_UNFINISHED = -1;
const CAP_POSITION = -2;

interface Capture {
  init: number;
  len: number;
}

export interface MatchState {
  src: string; // original source string (for substring extraction)
  s: Uint8Array; // source bytes
  slen: number;
  p: Uint8Array; // pattern bytes
  plen: number;
  level: number;
  capture: Capture[]; // pre-allocated, length `MAX_CAPTURES`
  matchdepth: number;
}

function toBytes(s: string): Uint8Array {
  const len = s.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = s.charCodeAt(i) & 0xFF;
  }
  return arr;
}

function matchClass(c: number, cl: number): boolean {
  const lcl = cl | 32;
  let res: boolean;
  switch (lcl) {
    case 97: // 'a'
      res = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
      break;
    case 99: // 'c'
      res = c < 32 || c === 127;
      break;
    case 100: // 'd'
      res = c >= 48 && c <= 57;
      break;
    case 103: // 'g'
      res = c > 32 && c < 127;
      break;
    case 108: // 'l'
      res = c >= 97 && c <= 122;
      break;
    case 112: // 'p'
      res = (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
        (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
      break;
    case 115: // 's'
      res = c === 32 || (c >= 9 && c <= 13);
      break;
    case 117: // 'u'
      res = c >= 65 && c <= 90;
      break;
    case 119: // 'w'
      res = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57);
      break;
    case 120: // 'x'
      res = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) ||
        (c >= 97 && c <= 102);
      break;
    case 122: // 'z'
      res = c === 0;
      break;
    default:
      return cl === c;
  }
  return (cl >= 97 && cl <= 122) ? res : !res;
}

function classEnd(p: Uint8Array, plen: number, pi: number): number {
  const ch = p[pi];
  pi++;
  if (ch === CH_ESC) {
    if (pi >= plen) {
      throw new Error("malformed pattern (ends with '%')");
    }
    return pi + 1;
  }
  if (ch === CH_LBRACKET) {
    if (pi < plen && p[pi] === CH_CARET) pi++;
    do {
      if (pi >= plen) {
        throw new Error("malformed pattern (missing ']')");
      }
      if (p[pi] === CH_ESC && pi + 1 < plen) {
        pi++;
      }
      pi++;
    } while (pi < plen && p[pi] !== CH_RBRACKET);
    if (pi >= plen) {
      throw new Error("malformed pattern (missing ']')");
    }
    return pi + 1;
  }
  return pi;
}

function matchBracketClass(
  c: number,
  p: Uint8Array,
  pi: number,
  ec: number,
): boolean {
  let sig = true;
  if (p[pi + 1] === CH_CARET) {
    sig = false;
    pi++;
  }
  pi++;
  while (pi < ec) {
    const pch = p[pi];
    if (pch === CH_ESC) {
      pi++;
      if (matchClass(c, p[pi])) return sig;
    } else if (
      pi + 2 < ec && p[pi + 1] === CH_DASH
    ) {
      pi += 2;
      if (pch <= c && c <= p[pi]) return sig;
    } else if (pch === c) {
      return sig;
    }
    pi++;
  }
  return !sig;
}

function singleMatch(
  ms: MatchState,
  si: number,
  pi: number,
  ep: number,
): boolean {
  if (si >= ms.slen) return false;
  const c = ms.s[si];
  const pch = ms.p[pi];
  if (pch === CH_DOT) return true;
  if (pch === CH_ESC) {
    return matchClass(c, ms.p[pi + 1]);
  }
  if (pch === CH_LBRACKET) {
    return matchBracketClass(c, ms.p, pi, ep - 1);
  }
  return pch === c;
}

function matchBalance(
  ms: MatchState,
  si: number,
  pi: number,
): number {
  if (pi >= ms.plen - 1) {
    throw new Error("malformed pattern (missing arguments to '%b')");
  }
  if (si >= ms.slen || ms.s[si] !== ms.p[pi]) {
    return -1;
  }
  const b = ms.p[pi];
  const e = ms.p[pi + 1];
  let cont = 1;
  si++;
  while (si < ms.slen) {
    const sc = ms.s[si];
    if (sc === e) {
      if (--cont === 0) return si + 1;
    } else if (sc === b) {
      cont++;
    }
    si++;
  }
  return -1;
}

function maxExpand(
  ms: MatchState,
  si: number,
  pi: number,
  ep: number,
): number {
  let i = 0;
  while (singleMatch(ms, si + i, pi, ep)) i++;
  while (i >= 0) {
    const res = match(ms, si + i, ep + 1);
    if (res >= 0) return res;
    i--;
  }
  return -1;
}

function minExpand(
  ms: MatchState,
  si: number,
  pi: number,
  ep: number,
): number {
  for (;;) {
    const res = match(ms, si, ep + 1);
    if (res >= 0) return res;
    if (singleMatch(ms, si, pi, ep)) {
      si++;
    } else {
      return -1;
    }
  }
}

function checkCapture(ms: MatchState, l: number): number {
  l -= CH_0 + 1;
  if (l < 0 || l >= ms.level || ms.capture[l].len === CAP_UNFINISHED) {
    throw new Error(`invalid capture index %${l + 1}`);
  }
  return l;
}

function captureToClose(ms: MatchState): number {
  for (let level = ms.level - 1; level >= 0; level--) {
    if (ms.capture[level].len === CAP_UNFINISHED) return level;
  }
  throw new Error("invalid pattern capture");
}

function startCapture(
  ms: MatchState,
  si: number,
  pi: number,
  what: number,
): number {
  const level = ms.level;
  if (level >= MAX_CAPTURES) throw new Error("too many captures");
  ms.capture[level].init = si;
  ms.capture[level].len = what;
  ms.level = level + 1;
  const res = match(ms, si, pi);
  if (res < 0) ms.level--;
  return res;
}

function endCapture(ms: MatchState, si: number, pi: number): number {
  const l = captureToClose(ms);
  const savedLen = ms.capture[l].len;
  ms.capture[l].len = si - ms.capture[l].init;
  const res = match(ms, si, pi);
  if (res < 0) ms.capture[l].len = savedLen;
  return res;
}

function matchCapture(ms: MatchState, si: number, l: number): number {
  const idx = checkCapture(ms, l);
  const cap = ms.capture[idx];
  if (cap.len === CAP_POSITION) {
    throw new Error(`invalid capture index %${idx + 1}`);
  }
  const len = cap.len;
  if (ms.slen - si < len) return -1;
  for (let k = 0; k < len; k++) {
    if (ms.s[cap.init + k] !== ms.s[si + k]) return -1;
  }
  return si + len;
}

function match(ms: MatchState, si: number, pi: number): number {
  if (ms.matchdepth-- <= 0) {
    throw new Error("pattern too complex");
  }
  while (true) {
    if (pi >= ms.plen) {
      ms.matchdepth++;
      return si;
    }
    const pch = ms.p[pi];
    if (pch === CH_OPEN) {
      if (pi + 1 < ms.plen && ms.p[pi + 1] === CH_CLOSE) {
        si = startCapture(ms, si, pi + 2, CAP_POSITION);
      } else {
        si = startCapture(ms, si, pi + 1, CAP_UNFINISHED);
      }
      ms.matchdepth++;
      return si;
    }
    if (pch === CH_CLOSE) {
      si = endCapture(ms, si, pi + 1);
      ms.matchdepth++;
      return si;
    }
    if (pch === CH_DOLLAR && pi + 1 === ms.plen) {
      ms.matchdepth++;
      return si === ms.slen ? si : -1;
    }
    if (pch === CH_ESC && pi + 1 < ms.plen) {
      const next = ms.p[pi + 1];
      if (next === 98) { // 'b'
        si = matchBalance(ms, si, pi + 2);
        if (si >= 0) {
          pi += 4;
          continue;
        }
        ms.matchdepth++;
        return -1;
      }
      if (next === 102) { // 'f'
        pi += 2;
        if (pi >= ms.plen || ms.p[pi] !== CH_LBRACKET) {
          throw new Error("missing '[' after '%f' in pattern");
        }
        const ep = classEnd(ms.p, ms.plen, pi);
        const previous = si === 0 ? 0 : ms.s[si - 1];
        const current = si < ms.slen ? ms.s[si] : 0;
        if (
          !matchBracketClass(previous, ms.p, pi, ep - 1) &&
          matchBracketClass(current, ms.p, pi, ep - 1)
        ) {
          pi = ep;
          continue;
        }
        ms.matchdepth++;
        return -1;
      }
      if (next >= CH_0 && next <= CH_9) {
        si = matchCapture(ms, si, next);
        if (si >= 0) {
          pi += 2;
          continue;
        }
        ms.matchdepth++;
        return -1;
      }
    }
    // default: class[*+?-]?
    const ep = classEnd(ms.p, ms.plen, pi);
    const matched = singleMatch(ms, si, pi, ep);
    if (!matched) {
      if (ep < ms.plen) {
        const suffix = ms.p[ep];
        if (
          suffix === CH_STAR || suffix === CH_QUESTION || suffix === CH_DASH
        ) {
          pi = ep + 1;
          continue;
        }
      }
      ms.matchdepth++;
      return -1;
    }
    if (ep < ms.plen) {
      const suffix = ms.p[ep];
      if (suffix === CH_QUESTION) {
        const res = match(ms, si + 1, ep + 1);
        if (res >= 0) {
          ms.matchdepth++;
          return res;
        }
        pi = ep + 1;
        continue;
      }
      if (suffix === CH_PLUS) {
        si++;
        const res = maxExpand(ms, si, pi, ep);
        ms.matchdepth++;
        return res;
      }
      if (suffix === CH_STAR) {
        const res = maxExpand(ms, si, pi, ep);
        ms.matchdepth++;
        return res;
      }
      if (suffix === CH_DASH) {
        const res = minExpand(ms, si, pi, ep);
        ms.matchdepth++;
        return res;
      }
    }
    si++;
    pi = ep;
    continue;
  }
}

function createMatchState(s: string, p: string): MatchState {
  const sb = toBytes(s);
  const pb = toBytes(p);
  const capture: Capture[] = new Array(MAX_CAPTURES);
  for (let i = 0; i < MAX_CAPTURES; i++) {
    capture[i] = { init: 0, len: 0 };
  }
  return {
    src: s,
    s: sb,
    slen: sb.length,
    p: pb,
    plen: pb.length,
    level: 0,
    capture,
    matchdepth: MAX_MATCH_DEPTH,
  };
}

function resetMatchState(ms: MatchState): void {
  ms.level = 0;
  ms.matchdepth = MAX_MATCH_DEPTH;
}

function noSpecials(p: string): boolean {
  for (let i = 0; i < p.length; i++) {
    if (SPECIALS_SET.has(p.charCodeAt(i))) return false;
  }
  return true;
}

// Public API

export type CaptureResult = { s: string } | { position: number };

interface RawCapture {
  kind: 0 | 1; // 0 = string slice, 1 = position
  start: number;
  len: number; // kind = 0: substring length; kind = 1: 1-based position
}

function getOneRawCapture(
  ms: MatchState,
  i: number,
  matchStart: number,
  matchEnd: number,
): RawCapture {
  if (i >= ms.level) {
    if (i !== 0) {
      throw new Error(`invalid capture index %${i + 1}`);
    }
    return { kind: 0, start: matchStart, len: matchEnd - matchStart };
  }
  const cap = ms.capture[i];
  if (cap.len === CAP_UNFINISHED) {
    throw new Error("unfinished capture");
  }
  if (cap.len === CAP_POSITION) {
    return { kind: 1, start: cap.init + 1, len: 0 };
  }
  return { kind: 0, start: cap.init, len: cap.len };
}

function rawToResult(ms: MatchState, raw: RawCapture): CaptureResult {
  if (raw.kind === 1) {
    return { position: raw.start };
  }
  return { s: ms.src.substring(raw.start, raw.start + raw.len) };
}

function getCaptures(
  ms: MatchState,
  matchStart: number,
  matchEnd: number,
): CaptureResult[] {
  const nlevels = ms.level === 0 ? 1 : ms.level;
  const result: CaptureResult[] = [];
  for (let i = 0; i < nlevels; i++) {
    result.push(rawToResult(ms, getOneRawCapture(ms, i, matchStart, matchEnd)));
  }
  return result;
}

function getRawCaptureString(ms: MatchState, raw: RawCapture): string {
  if (raw.kind === 1) {
    return raw.start.toString();
  }
  return ms.src.substring(raw.start, raw.start + raw.len);
}

export function patternFind(
  s: string,
  pattern: string,
  init: number = 1,
  plain: boolean = false,
): { start: number; end: number; captures: CaptureResult[] } | null {
  if (init < 1) init = 1;
  if (init > s.length + 1) return null;
  const si0 = init - 1;
  if (plain || noSpecials(pattern)) {
    const idx = s.indexOf(pattern, si0);
    if (idx < 0) return null;
    return { start: idx + 1, end: idx + pattern.length, captures: [] };
  }
  let p = pattern;
  let anchor = false;
  if (p.length > 0 && p.charCodeAt(0) === CH_CARET) {
    anchor = true;
    p = p.substring(1);
  }
  const ms = createMatchState(s, p);
  for (let si = si0; si <= ms.slen; si++) {
    resetMatchState(ms);
    const res = match(ms, si, 0);
    if (res >= 0) {
      const caps = ms.level === 0 ? [] : getCaptures(ms, si, res);
      return { start: si + 1, end: res, captures: caps };
    }
    if (anchor) break;
  }
  return null;
}

export function patternMatch(
  s: string,
  pattern: string,
  init: number = 1,
): CaptureResult[] | null {
  if (init < 1) init = 1;
  if (init > s.length + 1) return null;
  const si0 = init - 1;
  let p = pattern;
  let anchor = false;
  if (p.length > 0 && p.charCodeAt(0) === CH_CARET) {
    anchor = true;
    p = p.substring(1);
  }
  const ms = createMatchState(s, p);
  for (let si = si0; si <= ms.slen; si++) {
    resetMatchState(ms);
    const res = match(ms, si, 0);
    if (res >= 0) {
      return getCaptures(ms, si, res);
    }
    if (anchor) break;
  }
  return null;
}

export function patternGmatch(
  s: string,
  pattern: string,
  init: number = 1,
): () => CaptureResult[] | null {
  if (init < 1) init = 1;
  let p = pattern;
  let anchor = false;
  if (p.length > 0 && p.charCodeAt(0) === CH_CARET) {
    anchor = true;
    p = p.substring(1);
  }
  const ms = createMatchState(s, p);
  let src = init - 1;
  let lastMatch: number | null = null;
  return () => {
    while (src <= ms.slen) {
      resetMatchState(ms);
      const e = match(ms, src, 0);
      if (e >= 0 && e !== lastMatch) {
        const captures = getCaptures(ms, src, e);
        src = e;
        lastMatch = e;
        return captures;
      }
      src++;
      if (anchor) break;
    }
    return null;
  };
}

function expandReplacementString(
  repl: string,
  ms: MatchState,
  matchStart: number,
  matchEnd: number,
): string {
  const parts: string[] = [];
  let i = 0;
  while (i < repl.length) {
    const ch = repl.charCodeAt(i);
    if (ch === CH_ESC) {
      i++;
      if (i >= repl.length) {
        throw new Error("invalid use of '%' in replacement string");
      }
      const rc = repl.charCodeAt(i);
      if (rc === CH_ESC) {
        parts.push("%");
      } else if (rc === CH_0) {
        parts.push(ms.src.substring(matchStart, matchEnd));
      } else if (rc >= 49 && rc <= CH_9) {
        parts.push(getRawCaptureString(
          ms,
          getOneRawCapture(ms, rc - 49, matchStart, matchEnd),
        ));
      } else {
        throw new Error("invalid use of '%' in replacement string");
      }
    } else {
      // Collect consecutive literal characters
      let j = i + 1;
      while (j < repl.length && repl.charCodeAt(j) !== CH_ESC) j++;
      parts.push(repl.substring(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return parts.join("");
}

export interface GsubCallbacks {
  replString?: string;
  replFunction?: (
    ...captures: CaptureResult[]
  ) => Promise<string | null | undefined> | string | null | undefined;
  replTable?: (key: string) => string | null | undefined;
}

export async function patternGsub(
  s: string,
  pattern: string,
  callbacks: GsubCallbacks,
  maxN?: number,
): Promise<[string, number]> {
  const max_s = maxN !== undefined ? maxN : s.length + 1;
  let p = pattern;
  let anchor = false;
  if (p.length > 0 && p.charCodeAt(0) === CH_CARET) {
    anchor = true;
    p = p.substring(1);
  }
  const ms = createMatchState(s, p);
  let src = 0;
  let lastMatch: number | null = null;
  let n = 0;
  const resultParts: string[] = [];

  while (n < max_s) {
    resetMatchState(ms);
    const e = match(ms, src, 0);
    if (e >= 0 && e !== lastMatch) {
      n++;
      let replStr: string | null | undefined;
      if (callbacks.replString !== undefined) {
        replStr = expandReplacementString(callbacks.replString, ms, src, e);
      } else if (callbacks.replFunction) {
        const caps = getCaptures(ms, src, e);
        replStr = await callbacks.replFunction(...caps);
        if (replStr === null || replStr === undefined) {
          replStr = ms.src.substring(src, e);
        }
      } else if (callbacks.replTable) {
        const raw = getOneRawCapture(ms, 0, src, e);
        const key = getRawCaptureString(ms, raw);
        replStr = callbacks.replTable(key);
        if (replStr === null || replStr === undefined) {
          replStr = ms.src.substring(src, e);
        }
      }
      resultParts.push(replStr!);
      src = e;
      lastMatch = e;
    } else if (src < ms.slen) {
      resultParts.push(s[src]);
      src++;
      lastMatch = null;
    } else {
      break;
    }
    if (anchor) break;
  }
  if (src < s.length) {
    resultParts.push(s.substring(src));
  }
  return [resultParts.join(""), n];
}
