import { afterEach, beforeEach, expect, test } from "vitest";
import { HoverTracker, resolveHover } from "./hover.ts";

// hover.ts reaches for `document.elementFromPoint` and nothing else; the unit
// suite runs without a DOM, so stand one up for the duration of these tests.
const atPoint = new Map<string, unknown>();
const globals = globalThis as unknown as { document?: unknown };
let previousDocument: unknown;

beforeEach(() => {
  previousDocument = globals.document;
  atPoint.clear();
  globals.document = {
    elementFromPoint: (x: number, y: number) =>
      atPoint.get(`${x},${y}`) ?? null,
  };
});

afterEach(() => {
  globals.document = previousDocument;
});

/** Stand-in for a row element; `rowAt` below reads the path straight off it. */
function row(path: string) {
  return { path };
}

const rowAt = (node: any) => node?.path;

test("track remembers where the pointer was, so a re-resolve agrees", () => {
  const tracker = new HoverTracker();
  atPoint.set("10,20", row("Alpha"));
  atPoint.set("10,60", row("Beta"));

  tracker.track(
    { clientX: 10, clientY: 20, target: row("Alpha") } as any,
    rowAt,
  );
  expect(tracker.get()).toEqual("Alpha");

  // Nothing moved, but the rows under the pointer did.
  atPoint.set("10,20", row("Gamma"));
  resolveHover(tracker, rowAt);
  expect(tracker.get()).toEqual("Gamma");
});

test("a drop's coordinates replace the pre-drag ones", () => {
  const tracker = new HoverTracker();
  atPoint.set("10,20", row("Alpha"));
  atPoint.set("10,300", row("Target"));

  tracker.track(
    { clientX: 10, clientY: 20, target: row("Alpha") } as any,
    rowAt,
  );
  // Where it ended: a DragEvent is a MouseEvent, and this is the only event
  // that reports the pointer's position after a drag.
  tracker.track(
    { clientX: 10, clientY: 300, target: row("Target") } as any,
    rowAt,
  );

  // The re-resolve after the move lands must ask about the drop point, not
  // about wherever the drag started.
  resolveHover(tracker, rowAt);
  expect(tracker.get()).toEqual("Target");
});
