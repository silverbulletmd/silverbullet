import { counterpartTheme } from "@silverbulletmd/silverbullet/lib/themes";
import {
  clientStore,
  codeWidget,
  config,
  editor,
  system,
  theme,
} from "@silverbulletmd/silverbullet/syscalls";

// Run on "editor:init"
export async function setEditorMode() {
  // TODO: Remove at some point: temporary upgrade code
  const allSyscalls = await system.listSyscalls();
  const queryLuaObjects = allSyscalls.find(
    (sc) => sc.name === "index.queryLuaObjects",
  );

  if (!queryLuaObjects) {
    await editor.alert(
      "Client needs reloading to update the cache, required syscalls are not available in this version. This message may appear a few times. Reloading now.",
    );
    void editor.reloadUI();
  }

  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
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
  // `keyboardBar` is the key from before the markup bar's rename
  const markupBar =
    (await clientStore.get("markupBar")) ??
    (await clientStore.get("keyboardBar"));
  if (markupBar === false) {
    await editor.setUiOption("markupBar", false);
  }
}

export async function openTagNavigator() {
  await editor.openNavigator("std.tags");
  // The panel focuses its own filter input; false keeps the client from
  // pulling focus straight back to the editor.
  return false;
}

export async function toggleMarkdownSyntaxRendering() {
  let renderingSyntax = await editor.getUiOption("markdownSyntaxRendering");
  renderingSyntax = !renderingSyntax;
  await clientStore.set("markdownSyntaxRendering", renderingSyntax);
  await editor.setUiOption("markdownSyntaxRendering", renderingSyntax);
  await editor.rebuildEditorState();
}

export async function toggleMarkupBar() {
  const enabled = !(await editor.getUiOption("markupBar"));
  await clientStore.set("markupBar", enabled);
  await editor.setUiOption("markupBar", enabled);
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
  await editor.moveCursor(pos, true);
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
  // Two capture groups: line number, then optional column number
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
  await editor.moveCursorToLine(line, column, true);
}

export async function customFlashMessage(_def: any, message: string) {
  await editor.flashNotification(message);
}

export async function reloadSystem() {
  // Not editor.save(): that would overwrite an external edit to the open page.
  await system.reboot();
  await codeWidget.refreshAll();
  await editor.flashNotification("System and widgets reloaded!");
}

export async function selectTheme() {
  const [themes, active, device, configured] = await Promise.all([
    theme.list(),
    theme.getActive(),
    theme.getDeviceTheme(),
    config.get<string | undefined>("theme", undefined),
  ]);
  // With no override the active theme is already what the space default gives
  const spaceDefault =
    device === undefined ? active : themes.find((t) => t.page === configured);
  const options = [
    {
      name: spaceDefault
        ? `Use space default (${spaceDefault.displayName})`
        : "Use space default (follows system)",
      description: spaceDefault?.scheme ?? "",
      page: undefined as string | undefined,
    },
    ...[...themes]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((t) => ({
        name: t.displayName,
        description: t.page === active.page ? `${t.scheme}, current` : t.scheme,
        page: t.page as string | undefined,
      })),
  ];
  const selected = await editor.filterBox("Theme", options, "Pick a theme");
  if (!selected) {
    return;
  }
  await theme.setDeviceTheme((selected as (typeof options)[number]).page);
}

export async function toggleTheme() {
  const active = await theme.getActive();
  const counterpart = counterpartTheme(active, await theme.list());
  if (!counterpart) {
    await editor.flashNotification(
      `${active.displayName} has no ${active.scheme === "dark" ? "light" : "dark"} counterpart`,
      "info",
    );
    return;
  }
  await theme.setDeviceTheme(counterpart.page);
}
