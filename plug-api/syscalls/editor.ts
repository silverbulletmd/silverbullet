import type { PanelOptions } from "../../client/types/ui.ts";
import type {
  FilterOption,
  NotificationType,
  UploadFile,
} from "../../plug-api/types/client.ts";
import type { PageMeta } from "../../plug-api/types/index.ts";
import type { Path, Ref } from "../lib/ref.ts";
import { syscall } from "../syscall.ts";
import type { PanelMode } from "../types/client.ts";

/**
 * Important: These syscalls are only available in the client.
 * @module
 */

export function getCurrentPage(): Promise<string> {
  return syscall("editor.getCurrentPage");
}

export function getCurrentPageMeta(): Promise<PageMeta | undefined> {
  return syscall("editor.getCurrentPageMeta");
}

export function getCurrentPath(): Promise<Path> {
  return syscall("editor.getCurrentPath");
}

export function getRecentlyOpenedPages(): Promise<PageMeta[]> {
  return syscall("editor.getRecentlyOpenedPages");
}

/**
 * Returns a map of page name to the epoch-millisecond time it was last opened
 * on this client. Only pages that have ever been opened appear in it.
 */
export function getLastOpenedMap(): Promise<Record<string, number>> {
  return syscall("editor.getLastOpenedMap");
}

/**
 * Returns the file extensions (without a leading dot) that have a document
 * editor registered, i.e. the documents this client can open.
 */
export function getViewableExtensions(): Promise<string[]> {
  return syscall("editor.getViewableExtensions");
}

export function getCurrentEditor(): Promise<string> {
  return syscall("editor.getCurrentEditor");
}

export function getText(): Promise<string> {
  return syscall("editor.getText");
}

/**
 * This updates the editor text, but in a minimal-diff way:
 * it compares the current editor text with the new text, and only sends the changes to the editor, thereby preserving cursor location
 */
export function setText(
  newText: string,
  isolateHistory = false,
): Promise<void> {
  return syscall("editor.setText", newText, isolateHistory);
}

/**
 * Returns the position (in # of characters from the beginning of the file) of the cursor in the editor
 */
export function getCursor(): Promise<number> {
  return syscall("editor.getCursor");
}

export function getSelection(): Promise<{
  from: number;
  to: number;
  text: string;
}> {
  return syscall("editor.getSelection");
}

export function setSelection(from: number, to: number): Promise<void> {
  return syscall("editor.setSelection", from, to);
}

/**
 * Note: only available on the client
 */
export function invokeCommand(name: string, args?: string[]): Promise<any> {
  return syscall("editor.invokeCommand", name, args);
}

export function save(): Promise<void> {
  return syscall("editor.save");
}

export function navigate(
  ref: Ref | string,
  replaceState = false,
  newWindow = false,
): Promise<void> {
  return syscall("editor.navigate", ref, replaceState, newWindow);
}

/**
 * Opens the specified page reference, restoring the previous cursor and scroll
 * position for that page when one is remembered from the current session. Like
 * navigate(), an explicit pointer in the ref (e.g. `#header`, `@123`) still wins.
 */
export function open(
  ref: Ref | string,
  replaceState = false,
  newWindow = false,
): Promise<void> {
  return syscall("editor.open", ref, replaceState, newWindow);
}

export function openPageNavigator(
  mode: "page" | "meta" | "document" | "all" = "page",
): Promise<void> {
  return syscall("editor.openPageNavigator", mode);
}

export function openCommandPalette(): Promise<void> {
  return syscall("editor.openCommandPalette");
}

/**
 * Opens a navigator view by name.
 * @returns whether a view actually opened. `false` means there was none to
 * open.
 */
export function openNavigator(
  name: string,
  opts?: { segment?: string; phrase?: string },
): Promise<boolean> {
  return syscall("editor.openNavigator", name, opts);
}

export function reloadPage(): Promise<void> {
  return syscall("editor.reloadPage");
}

/** Useful when a plug toggles a piece of state that lint subscribers consult. */
export function forceLint(): Promise<void> {
  return syscall("editor.forceLint");
}

export function reloadUI(): Promise<void> {
  return syscall("editor.reloadUI");
}

export function rebuildEditorState(): Promise<void> {
  return syscall("editor.rebuildEditorState");
}

/**
 * Reloads the config and commands, also in the server
 */
export function reloadConfigAndCommands(): Promise<void> {
  return syscall("editor.reloadConfigAndCommands");
}

export function openUrl(url: string, existingWindow = false): Promise<void> {
  return syscall("editor.openUrl", url, existingWindow);
}

export function newWindow(): Promise<void> {
  return syscall("editor.newWindow");
}

/**
 * This is calling the `go()` method from the History Web API.
 * @param delta Position in history to move to relative to the current page,
 * where a negative value moves backwards, and positive forwards
 */
export function goHistory(delta: number): Promise<void> {
  return syscall("editor.goHistory", delta);
}

export function downloadFile(filename: string, dataUrl: string): Promise<void> {
  return syscall("editor.downloadFile", filename, dataUrl);
}

export function uploadFile(
  accept?: string,
  capture?: string,
): Promise<UploadFile> {
  return syscall("editor.uploadFile", accept, capture);
}

/**
 * Shows a flash notification to the user (top right corner)
 */
export function flashNotification(
  message: string,
  type: NotificationType = "info",
): Promise<void> {
  return syscall("editor.flashNotification", message, type);
}

/**
 * Exposes a filter box UI (similar to the page navigator and command palette)
 */
export function filterBox(
  label: string,
  options: FilterOption[],
  helpText = "",
  placeHolder = "",
): Promise<FilterOption | undefined> {
  return syscall("editor.filterBox", label, options, helpText, placeHolder);
}

/**
 * @param options optional keyed-panel options: a stable `key` makes the panel
 * persistent (backed by a long-lived iframe), `preload` mounts it hidden,
 * `events` lists client events forwarded into it, and `activationId` is an
 * opaque identity to pair with a later `hidePanel(id, activationId)` call --
 * see `hidePanel`
 */
export function showPanel(
  id: "lhs" | "rhs" | "bhs" | "modal",
  mode: PanelMode,
  html: HTMLElement | HTMLElement[] | string,
  script = "",
  options?: PanelOptions,
): Promise<void> {
  return syscall("editor.showPanel", id, mode, html, script, options);
}

/**
 * Hides a panel in the editor. If a keyed panel is currently visible in that
 * location, it is hidden (not unmounted); otherwise behaves as before.
 * @param expectedActivationId if given, only hides when the currently visible
 * keyed panel for `id` still carries this activation id (the one passed to
 * the `showPanel` call that opened it) -- otherwise a no-op, since something
 * newer has already taken the slot. Omit it to hide unconditionally, as
 * before. Guards against exactly the race a keyed panel that reuses one key
 * across activations (a modal picker, say) can hit: a close decided on one
 * activation whose underlying syscall reaches the host *after* a newer
 * activation already replaced it would otherwise hide that newer one instead
 * -- reading "what's currently visible" at hide time can't tell the two
 * apart on its own, since it is, by construction, always the newer one by
 * then.
 */
export function hidePanel(
  id: "lhs" | "rhs" | "bhs" | "modal",
  expectedActivationId?: string | number,
): Promise<void> {
  return syscall("editor.hidePanel", id, expectedActivationId);
}

export function focus(): Promise<void> {
  return syscall("editor.focus");
}

/**
 * The slot of the keyed panel whose iframe currently holds focus, or
 * `undefined` if none does (focus is in the editor, or nowhere in
 * particular).
 */
export function getFocusedPanelSlot(): Promise<
  "lhs" | "rhs" | "bhs" | "modal" | undefined
> {
  return syscall("editor.getFocusedPanelSlot");
}

export function showProgress(
  progressType: "sync" | "index",
  progressPercentage: number,
): Promise<void> {
  return syscall("editor.showProgress", progressType, progressPercentage);
}

export function hideProgress(progressType: "sync" | "index"): Promise<void> {
  return syscall("editor.showProgress", progressType);
}

export function insertAtPos(text: string, pos: number): Promise<void> {
  return syscall("editor.insertAtPos", text, pos);
}

export function replaceRange(
  from: number,
  to: number,
  text: string,
): Promise<void> {
  return syscall("editor.replaceRange", from, to, text);
}

export function moveCursor(pos: number, center = false): Promise<void> {
  return syscall("editor.moveCursor", pos, center);
}

export function moveCursorToLine(
  line: number,
  column = 1,
  center = false,
): Promise<void> {
  return syscall("editor.moveCursorToLine", line, column, center);
}

export function insertAtCursor(
  text: string,
  scrollIntoView = false,
  cursorPlaceHolder = false,
): Promise<void> {
  return syscall(
    "editor.insertAtCursor",
    text,
    scrollIntoView,
    cursorPlaceHolder,
  );
}

/**
 * Dispatch a CodeMirror transaction: https://codemirror.net/docs/ref/#state.Transaction
 */
export function dispatch(change: any): Promise<void> {
  return syscall("editor.dispatch", change);
}

export function prompt(
  message: string,
  defaultValue = "",
): Promise<string | undefined> {
  return syscall("editor.prompt", message, defaultValue);
}

/**
 * @param options optional settings; set `destructive: true` to style the
 *   confirm button as a destructive (danger) action
 */
export function confirm(
  message: string,
  options?: { destructive?: boolean },
): Promise<boolean> {
  return syscall("editor.confirm", message, options);
}

export function alert(message: string): Promise<boolean> {
  return syscall("editor.alert", message);
}

export function getUiOption(key: string): Promise<any> {
  return syscall("editor.getUiOption", key);
}

export function setUiOption(key: string, value: any): Promise<void> {
  return syscall("editor.setUiOption", key, value);
}

export function fold(): Promise<void> {
  return syscall("editor.fold");
}

export function unfold(): Promise<void> {
  return syscall("editor.unfold");
}

export function toggleFold(): Promise<void> {
  return syscall("editor.toggleFold");
}

export function foldAll(): Promise<void> {
  return syscall("editor.foldAll");
}

export function unfoldAll(): Promise<void> {
  return syscall("editor.unfoldAll");
}

export function undo(): Promise<void> {
  return syscall("editor.undo");
}

export function redo(): Promise<void> {
  return syscall("editor.redo");
}

export function openSearchPanel(): Promise<void> {
  return syscall("editor.openSearchPanel");
}

export function copyToClipboard(data: string | Blob): Promise<void> {
  return syscall("editor.copyToClipboard", data);
}

export function deleteLine(): Promise<void> {
  return syscall("editor.deleteLine");
}

export function selectAll(): Promise<void> {
  return syscall("editor.selectAll");
}

export function indentMore(): Promise<void> {
  return syscall("editor.indentMore");
}

export function indentLess(): Promise<void> {
  return syscall("editor.indentLess");
}

export function toggleComment(): Promise<void> {
  return syscall("editor.toggleComment");
}

export function moveLineUp(): Promise<void> {
  return syscall("editor.moveLineUp");
}

export function moveLineDown(): Promise<void> {
  return syscall("editor.moveLineDown");
}

export function cursorCharLeft(): Promise<void> {
  return syscall("editor.cursorCharLeft");
}
export function cursorCharRight(): Promise<void> {
  return syscall("editor.cursorCharRight");
}
export function cursorGroupLeft(): Promise<void> {
  return syscall("editor.cursorGroupLeft");
}
export function cursorGroupRight(): Promise<void> {
  return syscall("editor.cursorGroupRight");
}
export function cursorLineBoundaryLeft(): Promise<void> {
  return syscall("editor.cursorLineBoundaryLeft");
}
export function cursorLineBoundaryRight(): Promise<void> {
  return syscall("editor.cursorLineBoundaryRight");
}
export function cursorLineStart(): Promise<void> {
  return syscall("editor.cursorLineStart");
}
export function cursorLineEnd(): Promise<void> {
  return syscall("editor.cursorLineEnd");
}
export function cursorDocStart(): Promise<void> {
  return syscall("editor.cursorDocStart");
}
export function cursorDocEnd(): Promise<void> {
  return syscall("editor.cursorDocEnd");
}
export function cursorLineUp(): Promise<void> {
  return syscall("editor.cursorLineUp");
}
export function cursorLineDown(): Promise<void> {
  return syscall("editor.cursorLineDown");
}
export function cursorPageUp(): Promise<void> {
  return syscall("editor.cursorPageUp");
}
export function cursorPageDown(): Promise<void> {
  return syscall("editor.cursorPageDown");
}

export function selectCharLeft(): Promise<void> {
  return syscall("editor.selectCharLeft");
}
export function selectCharRight(): Promise<void> {
  return syscall("editor.selectCharRight");
}
export function selectGroupLeft(): Promise<void> {
  return syscall("editor.selectGroupLeft");
}
export function selectGroupRight(): Promise<void> {
  return syscall("editor.selectGroupRight");
}
export function selectLineBoundaryLeft(): Promise<void> {
  return syscall("editor.selectLineBoundaryLeft");
}
export function selectLineBoundaryRight(): Promise<void> {
  return syscall("editor.selectLineBoundaryRight");
}
export function selectLineStart(): Promise<void> {
  return syscall("editor.selectLineStart");
}
export function selectLineEnd(): Promise<void> {
  return syscall("editor.selectLineEnd");
}
export function selectDocStart(): Promise<void> {
  return syscall("editor.selectDocStart");
}
export function selectDocEnd(): Promise<void> {
  return syscall("editor.selectDocEnd");
}
export function selectLineUp(): Promise<void> {
  return syscall("editor.selectLineUp");
}
export function selectLineDown(): Promise<void> {
  return syscall("editor.selectLineDown");
}
export function selectPageUp(): Promise<void> {
  return syscall("editor.selectPageUp");
}
export function selectPageDown(): Promise<void> {
  return syscall("editor.selectPageDown");
}

export function deleteCharBackward(): Promise<void> {
  return syscall("editor.deleteCharBackward");
}
export function deleteCharForward(): Promise<void> {
  return syscall("editor.deleteCharForward");
}
export function deleteGroupBackward(): Promise<void> {
  return syscall("editor.deleteGroupBackward");
}
export function deleteGroupForward(): Promise<void> {
  return syscall("editor.deleteGroupForward");
}
export function deleteLineBoundaryBackward(): Promise<void> {
  return syscall("editor.deleteLineBoundaryBackward");
}
export function deleteLineBoundaryForward(): Promise<void> {
  return syscall("editor.deleteLineBoundaryForward");
}
export function transposeChars(): Promise<void> {
  return syscall("editor.transposeChars");
}

// Enter: accepts completion if popup open, else inserts newline
export function insertNewline(): Promise<void> {
  return syscall("editor.insertNewline");
}

export function acceptCompletion(): Promise<boolean> {
  return syscall("editor.acceptCompletion");
}
export function startCompletion(): Promise<void> {
  return syscall("editor.startCompletion");
}
export function closeCompletion(): Promise<void> {
  return syscall("editor.closeCompletion");
}

export function vimEx(exCommand: string): Promise<any> {
  return syscall("editor.vimEx", exCommand);
}

/**
 * Execute a vim config using the CodeMirror Vim Mode API
 */
export function configureVimMode(): Promise<any> {
  return syscall("editor.configureVimMode");
}

export function sendMessage(type: string, data?: any): Promise<void> {
  return syscall("editor.sendMessage", type, data);
}

export function isMobile(): Promise<boolean> {
  return syscall("editor.isMobile");
}

/**
 * Whether the client is currently laid out for a narrow screen — the
 * breakpoint below which sidebar panels render as full-width drawers over the
 * editor. A layout question, unlike `isMobile`, which asks about the pointer.
 */
export function isNarrowScreen(): Promise<boolean> {
  return syscall("editor.isNarrowScreen");
}
