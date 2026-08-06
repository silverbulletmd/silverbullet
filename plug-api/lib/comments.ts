export type CommentMessage = {
  addressee?: string;
  text: string;
  author?: string;
  date?: string;
};

export type ParsedComment = {
  quote?: string;
  thread: CommentMessage[];
  addressees: string[];
  waitingOn?: string;
  lastDate?: string;
};

const anchorRe = /^re:\s*["“”](.*)["“”]\s*$/;
const messageRe = /^@([A-Za-z0-9_-]+):\s*(.*)$/;
const signatureRe =
  /^(.*)\s*(?<!-)(?:—|–|-{1,2})\s+(?:([^,]+?),\s+)?(\d{4}-\d{2}-\d{2})\s*$/;

function extractSig(
  raw: string,
): { text: string; author?: string; date?: string } {
  const sig = raw.match(signatureRe);
  if (!sig) {
    return { text: raw.trim() };
  }
  return {
    text: sig[1].trim(),
    ...(sig[2] !== undefined ? { author: sig[2].trim() } : {}),
    date: sig[3],
  };
}

function hasSignature(raw: string): boolean {
  return signatureRe.test(raw);
}

// A machine directive: its first non-whitespace token starts with `#` or
// `/` followed by a letter (`<!--#lua ...-->`, `<!--/lua-->`, and future
// markers in the same family). Those are never comments, conforming or not.
const directiveRe = /^\s*[#/][A-Za-z]/;

export function parseCommentBlock(raw: string): ParsedComment | null {
  const m = raw.match(/^<!--([\s\S]*?)-->\s*$/);
  if (!m) {
    return null;
  }
  if (directiveRe.test(m[1])) {
    return null;
  }
  const lines = m[1].split("\n").map((l) => l.trim()).filter((l) =>
    l.length > 0
  );
  if (lines.length === 0) {
    return null;
  }
  let quote: string | undefined;
  const thread: CommentMessage[] = [];
  // The message currently being accumulated, if any: its addressee (if
  // addressed), its raw joined text so far, and whether a signature has
  // already closed it (see hasSignature above).
  let current: { addressee?: string; raw: string; closed: boolean } | null =
    null;

  const flush = () => {
    if (current !== null) {
      thread.push({
        ...(current.addressee !== undefined
          ? { addressee: current.addressee }
          : {}),
        ...extractSig(current.raw),
      });
      current = null;
    }
  };

  for (const [i, line] of lines.entries()) {
    if (i === 0) {
      const anchor = line.match(anchorRe);
      if (anchor) {
        quote = anchor[1];
        continue;
      }
    }
    const msg = line.match(messageRe);
    if (msg) {
      flush();
      current = { addressee: msg[1], raw: msg[2], closed: hasSignature(msg[2]) };
    } else if (current !== null && !current.closed) {
      // Continuation of the message currently being accumulated
      current.raw = current.raw.length > 0 ? `${current.raw} ${line}` : line;
      current.closed = hasSignature(current.raw);
    } else {
      // A bare line with nothing open to continue -- either nothing has
      // started yet, or the last message was already closed by a
      // signature. Either way, this starts a new unaddressed message.
      flush();
      current = { raw: line, closed: hasSignature(line) };
    }
  }
  flush();
  if (thread.length === 0) {
    return null;
  }
  const addressees = [
    ...new Set(
      thread.map((t) => t.addressee).filter((a): a is string => a !== undefined),
    ),
  ];
  const dates = thread.map((t) => t.date).filter((d): d is string => !!d);
  const waitingOn = thread[thread.length - 1].addressee;
  return {
    ...(quote !== undefined ? { quote } : {}),
    thread,
    addressees,
    ...(waitingOn !== undefined ? { waitingOn } : {}),
    ...(dates.length > 0 ? { lastDate: dates[dates.length - 1] } : {}),
  };
}

export function sanitizeQuote(s: string): string {
  return s.replace(/\s+/g, " ").replace(/"/g, "'").replace(/--/g, "–")
    .trim().slice(0, 80);
}

export function buildCommentScaffold(
  opts: { quote?: string; author?: string; date: string },
): { text: string; cursorOffset: number } {
  // A signature is always present, even without a configured author, so a
  // scaffold with no quote still carries a recognizable marker.
  const sig = opts.author
    ? ` — ${opts.author}, ${opts.date}`
    : ` — ${opts.date}`;
  // Generated comments are left-aligned (no indentation), and once a block
  // spans multiple lines the closing `-->` gets its own line. A quoted
  // scaffold is multi-line (the `re:` line plus the message line), so its
  // closer moves to a third line; a quote-less scaffold stays a single line
  // with an inline closer.
  if (opts.quote) {
    const prefix = `<!-- re: "${opts.quote}"\n`;
    return { text: `${prefix}${sig}\n-->`, cursorOffset: prefix.length };
  }
  const prefix = `<!-- `;
  return { text: `${prefix}${sig} -->`, cursorOffset: prefix.length };
}

export function computeCommentInsertion(
  docText: string,
  selFrom: number,
  selTo: number,
  opts: { author?: string; date: string },
): { insertAt: number; text: string; cursorPos: number } {
  // End of the block containing selTo: scan forward line by line until a
  // blank line or EOF; insert at the end of the last non-blank line.
  let insertAt = selTo;
  while (insertAt < docText.length) {
    const nl = docText.indexOf("\n", insertAt);
    const lineEnd = nl === -1 ? docText.length : nl;
    const nextLineStart = nl === -1 ? docText.length : nl + 1;
    const nextNl = docText.indexOf("\n", nextLineStart);
    const nextLineEnd = nextNl === -1 ? docText.length : nextNl;
    insertAt = lineEnd;
    const nextLine = docText.slice(nextLineStart, nextLineEnd);
    if (nextLineStart >= docText.length || nextLine.trim() === "") {
      break;
    }
    insertAt = nextLineStart;
  }
  const quote = sanitizeQuote(docText.slice(selFrom, selTo));
  const scaffold = buildCommentScaffold({
    ...(quote.length > 0 ? { quote } : {}),
    ...(opts.author ? { author: opts.author } : {}),
    date: opts.date,
  });
  const text = `\n${scaffold.text}`;
  return {
    insertAt,
    text,
    cursorPos: insertAt + 1 + scaffold.cursorOffset,
  };
}
