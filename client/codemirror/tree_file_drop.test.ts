import { expect, test, vi } from "vitest";
import { FILE_DRAG_MIME } from "../navigator/ui/file_drag_export.ts";
import { handleTreeFileDrop, insertTreeFileLink } from "./tree_file_drop.ts";

function drop(payload: string, pos = 4, selection = { from: 0, to: 0 }) {
  const preventDefault = vi.fn();
  const dispatch = vi.fn();
  const view = {
    posAtCoords: () => pos,
    state: { selection: { main: selection } },
    dispatch,
  };
  const event = {
    clientX: 100,
    clientY: 200,
    dataTransfer: {
      types: [FILE_DRAG_MIME],
      getData: (mime: string) => (mime === FILE_DRAG_MIME ? payload : ""),
    },
    preventDefault,
  };
  return { event, view, preventDefault, dispatch };
}

test.each([
  ['{"path":"Notes/Guide","kind":"page"}', "[[Notes/Guide]]"],
  ['{"path":"Assets/file.pdf","kind":"document"}', "[[Assets/file.pdf]]"],
  [
    '{"path":"Assets/photo.png","kind":"document","contentType":"image/png"}',
    "![[Assets/photo.png]]",
  ],
])(
  "tree file drop inserts the correct link at the pointer",
  (payload, link) => {
    const { event, view, preventDefault, dispatch } = drop(payload);
    expect(handleTreeFileDrop(event as never, view as never)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 4, to: 4, insert: link },
      selection: { anchor: 4 + link.length },
      scrollIntoView: true,
    });
  },
);

test("drop on a selection replaces that selection", () => {
  const { event, view, dispatch } = drop('{"path":"Guide","kind":"page"}', 4, {
    from: 2,
    to: 6,
  });
  expect(handleTreeFileDrop(event as never, view as never)).toBe(true);
  expect(dispatch).toHaveBeenCalledWith({
    changes: { from: 2, to: 6, insert: "[[Guide]]" },
    selection: { anchor: 11 },
    scrollIntoView: true,
  });
});

test("malformed internal payload does not insert a link", () => {
  const { event, view, preventDefault, dispatch } = drop("bad JSON");
  expect(handleTreeFileDrop(event as never, view as never)).toBe(false);
  expect(preventDefault).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test("native image file drop inserts an embedded link", () => {
  const { view, dispatch } = drop("", 4);
  expect(
    insertTreeFileLink(
      { path: "Pictures/map.png", kind: "document", contentType: "image/png" },
      { x: 100, y: 200 },
      view as never,
    ),
  ).toBe(true);
  expect(dispatch).toHaveBeenCalledWith({
    changes: { from: 4, to: 4, insert: "![[Pictures/map.png]]" },
    selection: { anchor: 25 },
    scrollIntoView: true,
  });
});
