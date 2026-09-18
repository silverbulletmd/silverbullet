import { readFileSync, writeFileSync } from "node:fs";

const file = new URL(
  "../node_modules/@codemirror/view/dist/index.js",
  import.meta.url,
);

// WebKit can return adjacent right-edge positions for repeated posAtCoords()
// queries on the same wrapped row. CodeMirror's drawSelection() then treats a
// word selection as spanning two rows and paints the whole line, even though
// the selection still contains only that word. Compare the endpoints' vertical
// coordinates so the selection uses the single-row drawing path.
const before = `    if (visualStart && visualEnd && visualStart.from == visualEnd.from && visualStart.to == visualEnd.to) {
        return pieces(drawForLine(range.from, range.to, visualStart));
    }`;
const after = `    let startCoords = visualStart && view.coordsAtPos(from, 2);
    let endCoords = visualEnd && view.coordsAtPos(to, -2);
    let sameRow = startCoords && endCoords &&
        Math.abs(startCoords.top - endCoords.top) < 1 &&
        Math.abs(startCoords.bottom - endCoords.bottom) < 1;
    if (visualStart && visualEnd &&
        (visualStart.from == visualEnd.from && visualStart.to == visualEnd.to || sameRow)) {
        return pieces(drawForLine(range.from, range.to, visualStart));
    }`;

const source = readFileSync(file, "utf8");
if (!source.includes(after)) {
  if (!source.includes(before)) {
    throw new Error(
      "CodeMirror selection patch no longer matches @codemirror/view",
    );
  }
  writeFileSync(file, source.replace(before, after));
}
