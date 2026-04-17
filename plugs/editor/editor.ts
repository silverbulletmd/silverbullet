import {
  clientStore,
  codeWidget,
  config,
  editor,
  index,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";

// Run on "editor:init"
export async function setEditorMode() {
  // TODO: Remove at some point: temporary upgrade code
  const allSyscalls = await system.listSyscalls();
  // console.log("All syscalls", allSyscalls);
  const queryLuaObjects = allSyscalls.find(
    (sc) => sc.name === "index.queryLuaObjects",
  );

  // console.log(readPageWithMetaCall);

  if (!queryLuaObjects) {
    await editor.alert(
      "Client needs reloading to update the cache, required syscalls are not available in this version. This message may appear a few times. Reloading now.",
    );
    void editor.reloadUI();
  }

  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  // Only set the darkmode value if it was deliberatly set in the clientstore,
  // otherwise leave it so the client can choose depending on the system
  // settings
  const darkMode = await clientStore.get("darkMode");
  if (darkMode != null) {
    await editor.setUiOption("darkMode", darkMode);
  }
  const markdownSyntaxRendering = await clientStore.get(
    "markdownSyntaxRendering",
  );
  if (markdownSyntaxRendering != null) {
    await editor.setUiOption(
      "markdownSyntaxRendering",
      markdownSyntaxRendering,
    );
    await editor.rebuildEditorState();
  }
}

export function openCommandPalette() {
  return editor.openCommandPalette();
}

export async function openPageNavigator() {
  await editor.openPageNavigator("page");
}

export async function openMetaNavigator() {
  await editor.openPageNavigator("meta");
}

export async function openTagNavigator() {
  // Query all tags with a matching parent
  const allTags: FilterOption[] = (
    await index.queryLuaObjects<string>("tag", {
      select: { type: "Variable", name: "name", ctx: {} as any },
      distinct: true,
    })
  ).map((name) => ({ name }));

  const selectedTag = await editor.filterBox(
    "Open",
    allTags,
    "Press <tt>enter</tt> to go to the tag page of the selected tag.",
    "Tag",
  );
  if (!selectedTag) {
    return;
  }
  const tagPage = await config.get(
    ["tags", selectedTag.name, "tagPage"],
    null,
  );
  await editor.navigate(tagPage ?? `tag:${selectedTag.name}`);
}

export async function openDocumentNavigator() {
  await editor.openPageNavigator("document");
}

export async function openAllNavigator() {
  await editor.openPageNavigator("all");
}

export async function toggleDarkMode() {
  let darkMode = await editor.getUiOption("darkMode");
  darkMode = !darkMode;
  await clientStore.set("darkMode", darkMode);
  await editor.reloadUI();
}

export async function toggleMarkdownSyntaxRendering() {
  let renderingSyntax = await editor.getUiOption("markdownSyntaxRendering");
  renderingSyntax = !renderingSyntax;
  await clientStore.set("markdownSyntaxRendering", renderingSyntax);
  await editor.setUiOption("markdownSyntaxRendering", renderingSyntax);
  await editor.rebuildEditorState();
}

export async function centerCursorCommand() {
  const pos = await editor.getCursor();
  await editor.moveCursor(pos, true);
}

export async function moveToPosCommand() {
  let posString = await editor.prompt("Move to position:");
  if (posString === undefined) {
    return;
  }
  posString = posString.trim();
  if (posString === "") {
    void editor.flashNotification("Must provide a position.", "error");
    return;
  }
  const pos = +posString;
  await editor.moveCursor(pos, true); // showing the movement for better UX
}

export async function copyRefCommand() {
  const page = await editor.getCurrentPage();
  const pos = await editor.getCursor();
  await editor.copyToClipboard(`[[${page}@${pos}]]`);
  await editor.flashNotification("Ref copied to clipboard");
}

export async function copyLinkCommand() {
  const page = await editor.getCurrentPage();
  const pos = await editor.getCursor();
  await editor.copyToClipboard(`${await system.getBaseURI()}${page}@${pos}`);
  await editor.flashNotification("Link copied to clipboard");
}

export async function moveToLineCommand() {
  let lineString = await editor.prompt("Move to line (and optionally column):");
  if (lineString === undefined) {
    return;
  }
  lineString = lineString.trim();
  if (lineString === "") {
    void editor.flashNotification("Must provide a line number.", "error");
    return;
  }
  // Match sequence of digits at the start, optionally another sequence
  const numberRegex = /^(\d+)(?:[^\d]+(\d+))?/;
  const match = lineString.match(numberRegex);
  if (!match) {
    await editor.flashNotification(
      "Could not parse line number in prompt",
      "error",
    );
    return;
  }
  let column = 1;
  const line = parseInt(match[1], 10);
  if (match[2]) {
    column = parseInt(match[2], 10);
  }
  await editor.moveCursorToLine(line, column, true); // showing the movement for better UX
}

export async function customFlashMessage(_def: any, message: string) {
  await editor.flashNotification(message);
}

export async function reloadSystem() {
  await editor.save();
  await editor.reloadConfigAndCommands();
  await codeWidget.refreshAll();
  await editor.flashNotification("System and widgets reloaded!");
}

export function refreshAllWidgets() {
  void codeWidget.refreshAll();
}

export async function findInPageCommand() {
  await editor.openSearchPanel();
  return false;
}

export function undoCommand() {
  return editor.undo();
}

export function redoCommand() {
  return editor.redo();
}

export function deleteLineCommand() {
  return editor.deleteLine();
}

export function selectAllCommand() {
  return editor.selectAll();
}

export async function indentCommand() {
  // Accept completion popup suggestion if open, else indent
  if (await editor.acceptCompletion()) return;
  await editor.indentMore();
}

export function outdentCommand() {
  return editor.indentLess();
}

export function newWindowCommand() {
  return editor.newWindow();
}

// Cursor motions
export function cursorCharLeftCommand() {
  return editor.cursorCharLeft();
}
export function cursorCharRightCommand() {
  return editor.cursorCharRight();
}
export function cursorGroupLeftCommand() {
  return editor.cursorGroupLeft();
}
export function cursorGroupRightCommand() {
  return editor.cursorGroupRight();
}
export function cursorLineBoundaryLeftCommand() {
  return editor.cursorLineBoundaryLeft();
}
export function cursorLineBoundaryRightCommand() {
  return editor.cursorLineBoundaryRight();
}
export function cursorLineStartCommand() {
  return editor.cursorLineStart();
}
export function cursorLineEndCommand() {
  return editor.cursorLineEnd();
}
export function cursorDocStartCommand() {
  return editor.cursorDocStart();
}
export function cursorDocEndCommand() {
  return editor.cursorDocEnd();
}
export function cursorLineUpCommand() {
  return editor.cursorLineUp();
}
export function cursorLineDownCommand() {
  return editor.cursorLineDown();
}
export function cursorPageUpCommand() {
  return editor.cursorPageUp();
}
export function cursorPageDownCommand() {
  return editor.cursorPageDown();
}

// Selection-extending motions
export function selectCharLeftCommand() {
  return editor.selectCharLeft();
}
export function selectCharRightCommand() {
  return editor.selectCharRight();
}
export function selectGroupLeftCommand() {
  return editor.selectGroupLeft();
}
export function selectGroupRightCommand() {
  return editor.selectGroupRight();
}
export function selectLineBoundaryLeftCommand() {
  return editor.selectLineBoundaryLeft();
}
export function selectLineBoundaryRightCommand() {
  return editor.selectLineBoundaryRight();
}
export function selectLineStartCommand() {
  return editor.selectLineStart();
}
export function selectLineEndCommand() {
  return editor.selectLineEnd();
}
export function selectDocStartCommand() {
  return editor.selectDocStart();
}
export function selectDocEndCommand() {
  return editor.selectDocEnd();
}
export function selectLineUpCommand() {
  return editor.selectLineUp();
}
export function selectLineDownCommand() {
  return editor.selectLineDown();
}
export function selectPageUpCommand() {
  return editor.selectPageUp();
}
export function selectPageDownCommand() {
  return editor.selectPageDown();
}

// Delete / edit
export function deleteCharBackwardCommand() {
  return editor.deleteCharBackward();
}
export function deleteCharForwardCommand() {
  return editor.deleteCharForward();
}
export function deleteGroupBackwardCommand() {
  return editor.deleteGroupBackward();
}
export function deleteGroupForwardCommand() {
  return editor.deleteGroupForward();
}
export function deleteLineBoundaryBackwardCommand() {
  return editor.deleteLineBoundaryBackward();
}
export function deleteLineBoundaryForwardCommand() {
  return editor.deleteLineBoundaryForward();
}
export function transposeCharsCommand() {
  return editor.transposeChars();
}
export function insertNewlineCommand() {
  return editor.insertNewline();
}

// Completion popup
export function startCompletionCommand() {
  return editor.startCompletion();
}
export function closeCompletionCommand() {
  return editor.closeCompletion();
}
