import type { EditorView } from "@codemirror/view";
import {
  FILE_DRAG_MIME,
  parseFileDragData,
  type FileDragPayload,
} from "../navigator/ui/file_drag_export.ts";

export function handleTreeFileDrop(
  event: DragEvent,
  view: EditorView,
): boolean {
  const transfer = event.dataTransfer;
  if (!transfer?.types.includes(FILE_DRAG_MIME)) return false;
  const file = parseFileDragData(transfer.getData(FILE_DRAG_MIME));
  if (!file) return false;
  if (!insertTreeFileLink(file, { x: event.clientX, y: event.clientY }, view))
    return false;
  event.preventDefault();
  return true;
}

export function insertTreeFileLink(
  file: FileDragPayload,
  coords: { x: number; y: number },
  view: EditorView,
): boolean {
  const pos = view.posAtCoords(coords);
  if (pos === null) return false;
  const selection = view.state.selection.main;
  const replace =
    !selection.empty && pos >= selection.from && pos <= selection.to;
  const from = replace ? selection.from : pos;
  const to = replace ? selection.to : pos;
  const embedded =
    file.kind === "document" && file.contentType?.startsWith("image/");
  const link = `${embedded ? "!" : ""}[[${file.path}]]`;
  view.dispatch({
    changes: { from, to, insert: link },
    selection: { anchor: from + link.length },
    scrollIntoView: true,
  });
  return true;
}
