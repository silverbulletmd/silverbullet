import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function quoteSelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();
  let from = selection.from;
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  if (text[from] === ">" && text[from + 1] === " ") {
    // Already quoted, we have to unquote
    text = text.slice(from + 2, selection.to);
    text = text.replaceAll("\n> ", "\n");
  } else {
    text = text.slice(from, selection.to);
    text = `> ${text.replaceAll("\n", "\n> ")}`;
  }
  await editor.replaceRange(from, selection.to, text);
}

export async function listifySelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();

  //if very first of doc, just add a bullet and end
  if (selection.to == 0 && selection.from == 0) {
    await editor.insertAtCursor("* ");
    return;
  }

  let from = selection.from;
  if (text[from] == "\n") {
    //end of line, need to find previous line break
    from--;
  }
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  text = text.slice(from, selection.to);
  text = `* ${text.replaceAll(/\n(?!\n)/g, "\n* ")}`;
  await editor.replaceRange(from, selection.to, text);
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
  text = `1. ${
    text.replaceAll(/\n(?!\n)/g, () => {
      counter++;
      return `\n${counter}. `;
    })
  }`;
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
    // empty selection
    if (markerAt(selection.from)) {
      // Already there, skipping ahead
      await editor.moveCursor(selection.from + marker.length);
    } else {
      // Not there, inserting
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
      // Adding
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
      // Removing
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
