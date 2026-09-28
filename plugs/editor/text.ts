import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { listifyLines, taskifyLines } from "./line_prefix.ts";

export async function quoteSelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();
  let from = selection.from;
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  if (text[from] === ">" && text[from + 1] === " ") {
    text = text.slice(from + 2, selection.to);
    text = text.replaceAll("\n> ", "\n");
  } else {
    text = text.slice(from, selection.to);
    text = `> ${text.replaceAll("\n", "\n> ")}`;
  }
  await editor.replaceRange(from, selection.to, text);
}

export async function listifySelection() {
  const selection = await editor.getSelection();
  const result = listifyLines(
    await editor.getText(),
    selection.from,
    selection.to,
  );
  await editor.replaceRange(result.from, result.to, result.insert);
  if (result.cursor !== undefined) await editor.moveCursor(result.cursor);
}

export async function taskifyLine() {
  const selection = await editor.getSelection();
  const result = taskifyLines(
    await editor.getText(),
    selection.from,
    selection.to,
    await editor.getCursor(),
  );
  if (!result) return;
  await editor.replaceRange(result.from, result.to, result.insert);
  await editor.moveCursor(result.cursor);
}

export async function wikiLinkSelection() {
  const selection = await editor.getSelection();
  if (selection.from !== selection.to) {
    const text = await editor.getText();
    const linked = `[[${text.slice(selection.from, selection.to)}]]`;
    await editor.replaceRange(selection.from, selection.to, linked);
    await editor.moveCursor(selection.from + linked.length);
    return;
  }
  await editor.insertAtCursor("[[|^|]]", false, true);
  await editor.startCompletion();
}

export async function numberListifySelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();
  let from = selection.from;
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  text = text.slice(from, selection.to);
  let counter = 1;
  text = `1. ${text.replaceAll(/\n(?!\n)/g, () => {
    counter++;
    return `\n${counter}. `;
  })}`;
  await editor.replaceRange(from, selection.to, text);
}

export async function linkSelection() {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  const textSelection = text.slice(selection.from, selection.to);
  let linkedText = `[]()`;
  let pos = 1;
  if (textSelection.length > 0) {
    try {
      new URL(textSelection);
      linkedText = `[](${textSelection})`;
    } catch {
      linkedText = `[${textSelection}]()`;
      pos = linkedText.length - 1;
    }
  }
  await editor.replaceRange(selection.from, selection.to, linkedText);
  await editor.moveCursor(selection.from + pos);
}

export function wrapSelection(cmdDef: any) {
  return insertMarker(cmdDef.wrapper);
}

async function insertMarker(marker: string) {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  if (selection.from === selection.to) {
    if (markerAt(selection.from)) {
      await editor.moveCursor(selection.from + marker.length);
    } else {
      await editor.insertAtCursor(marker + marker);
      await editor.moveCursor(selection.from + marker.length);
    }
  } else {
    let from = selection.from;
    let to = selection.to;
    let hasMarker = markerAt(from);
    if (!markerAt(from)) {
      // Maybe just before the cursor? We'll accept that
      from = selection.from - marker.length;
      to = selection.to + marker.length;
      hasMarker = markerAt(from);
    }

    if (!hasMarker) {
      await editor.replaceRange(
        selection.from,
        selection.to,
        marker + text.slice(selection.from, selection.to) + marker,
      );
      await editor.setSelection(
        selection.from + marker.length,
        selection.to + marker.length,
      );
    } else {
      await editor.replaceRange(
        from,
        to,
        text.substring(from + marker.length, to - marker.length),
      );
      await editor.setSelection(from, to - marker.length * 2);
    }
  }

  function markerAt(pos: number) {
    for (let i = 0; i < marker.length; i++) {
      if (text[pos + i] !== marker[i]) {
        return false;
      }
    }
    return true;
  }
}
