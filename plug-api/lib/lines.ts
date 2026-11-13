/** The start of the line `pos` is on. */
export function lineStart(text: string, pos: number): number {
  // lastIndexOf with a negative index searches from 0, so pos 0 needs a guard
  return pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;
}

/** The end of the line `pos` is on (the index of its newline, or text length). */
export function lineEnd(text: string, pos: number): number {
  const end = text.indexOf("\n", pos);
  return end === -1 ? text.length : end;
}
