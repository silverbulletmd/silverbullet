import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function moveItemUp() {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();

  try {
    const currentItemBounds = determineItemBounds(text, cursorPos);
    let previousItemBounds: ReturnType<typeof determineItemBounds> | undefined;

    try {
      previousItemBounds = determineItemBounds(
        text,
        currentItemBounds.from - 1,
        currentItemBounds.indentLevel,
      );
      if (currentItemBounds.from === previousItemBounds.from) {
        throw new Error("Already at the top");
      }
    } catch {
      // Ok, top of the list, let's find the previous item at any other indent level and adapt
      previousItemBounds = determineItemBounds(
        text,
        currentItemBounds.from - 1,
      );
    }

    let newPreviousText = text.slice(
      previousItemBounds.from,
      previousItemBounds.to,
    );
    // If the current item is embedded inside the previous item, we need to strip it out
    if (
      currentItemBounds.from >= previousItemBounds.from &&
      currentItemBounds.to <= previousItemBounds.to
    ) {
      newPreviousText =
        text.slice(previousItemBounds.from, currentItemBounds.from) +
        text.slice(currentItemBounds.to, previousItemBounds.to);
    }

    const newText =
      ensureNewLine(text.slice(currentItemBounds.from, currentItemBounds.to)) +
      newPreviousText;
    const newCursorPos = (cursorPos - currentItemBounds.from) +
      previousItemBounds.from;

    // console.log("New replacement text", newText);

    await editor.dispatch({
      changes: [
        {
          from: Math.min(previousItemBounds.from, currentItemBounds.from),
          to: Math.max(currentItemBounds.to, previousItemBounds.to),
          insert: newText,
        },
      ],
      selection: {
        anchor: newCursorPos,
      },
    });
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

export async function moveItemDown() {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();

  try {
    const currentItemBounds = determineItemBounds(text, cursorPos);
    let nextItemBounds: ReturnType<typeof determineItemBounds> | undefined;
    try {
      nextItemBounds = determineItemBounds(
        text,
        currentItemBounds.to + 1,
        currentItemBounds.indentLevel,
      );

      if (currentItemBounds.from === nextItemBounds.from) {
        throw new Error("Already at the bottom");
      }
    } catch {
      nextItemBounds = determineItemBounds(
        text,
        currentItemBounds.to + 1,
        undefined,
        false,
      );
    }

    if (currentItemBounds.to === nextItemBounds.to) {
      throw new Error("Already at the bottom");
    }

    const nextItemText = ensureNewLine(
      text.slice(nextItemBounds.from, nextItemBounds.to),
    );
    // console.log("Next item text", nextItemText);
    const newText = nextItemText +
      text.slice(currentItemBounds.from, currentItemBounds.to);
    const newCursorPos = (cursorPos - currentItemBounds.from) +
      currentItemBounds.from + nextItemText.length;
    await editor.dispatch({
      changes: [
        {
          from: Math.min(nextItemBounds.from, currentItemBounds.from),
          to: Math.max(nextItemBounds.to, currentItemBounds.to),
          insert: newText,
        },
      ],
      selection: {
        anchor: newCursorPos,
      },
    });
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

export async function indentItem() {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();

  try {
    const currentItemBounds = determineItemBounds(text, cursorPos);
    const itemText = text.slice(currentItemBounds.from, currentItemBounds.to);
    const newText = itemText.split("\n").map((line) =>
      line ? "  " + line : line
    ).join("\n");
    const preText = text.slice(currentItemBounds.from, cursorPos);
    const newCursorPos = cursorPos + preText.split("\n").length * 2;
    await editor.dispatch({
      changes: [
        {
          from: currentItemBounds.from,
          to: currentItemBounds.to,
          insert: newText,
        },
      ],
      selection: {
        anchor: newCursorPos,
      },
    });
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

export async function outdentItem() {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();

  try {
    const currentItemBounds = determineItemBounds(text, cursorPos);
    const itemText = text.slice(currentItemBounds.from, currentItemBounds.to);
    if (!itemText.startsWith("  ")) {
      throw new Error("Cannot outdent further");
    }
    const newText = itemText.split("\n").map((line) =>
      line.startsWith("  ") ? line.substring(2) : line
    ).join("\n");
    const preText = text.slice(currentItemBounds.from, cursorPos);
    const newCursorPos = cursorPos - preText.split("\n").length * 2;
    await editor.dispatch({
      changes: [
        {
          from: currentItemBounds.from,
          to: currentItemBounds.to,
          insert: newText,
        },
      ],
      selection: {
        anchor: newCursorPos,
      },
    });
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

export function ensureNewLine(s: string) {
  if (!s.endsWith("\n")) {
    return s + "\n";
  } else {
    return s;
  }
}

export function determineItemBounds(
  text: string,
  pos: number,
  minIndentLevel?: number,
  withChildren = true,
): { from: number; to: number; indentLevel: number } {
  // Find the start of the item marked with a bullet
  let currentItemStart = pos;
  let indentLevel = 0;
  while (true) {
    while (currentItemStart > 0 && text[currentItemStart - 1] !== "\n") {
      currentItemStart--;
    }
    // Check if the line is a bullet and determine the indent level
    indentLevel = 0;
    while (text[currentItemStart + indentLevel] === " ") {
      indentLevel++;
    }
    if (minIndentLevel !== undefined && indentLevel < minIndentLevel) {
      throw new Error("No item found at minimum indent level");
    }
    if (minIndentLevel !== undefined && indentLevel > minIndentLevel) {
      // Not at the desired indent level yet, let's go up another line
      currentItemStart--;
      if (currentItemStart <= 0) {
        // We've reached the top of the document, no bullet found
        throw new Error("No item found");
      }
      continue;
    }
    if (["-", "*"].includes(text[currentItemStart + indentLevel])) {
      // This is a bullet line, found it, let's break out of this loop
      break;
    } else {
      // Not a bullet line, let's go up another line
      currentItemStart--;
      if (currentItemStart <= 0) {
        // We've reached the top of the document, no bullet found
        throw new Error("No item found");
      }
    }
  }

  // Ok, so at this point we have determine the starting point of our item
  // Relevant variables are currentItemStart and indentLevel
  // Now let's find the end point
  let currentItemEnd = currentItemStart + 1;
  while (true) {
    // Let's traverse to the end of the line
    while (currentItemEnd < text.length && text[currentItemEnd - 1] !== "\n") {
      currentItemEnd++;
    }
    if (!withChildren) {
      // We're not interested in the children, so let's stop here
      break;
    }
    // Check the indent level of the next line
    let nextIndentLevel = 0;
    while (text[currentItemEnd + nextIndentLevel] === " ") {
      nextIndentLevel++;
    }
    if (nextIndentLevel <= indentLevel) {
      // This is a line indentend less than the current item, found it, let's break out of this loop
      break;
    } else {
      // Not a bullet line, let's go up another line
      currentItemEnd++;
      if (currentItemEnd >= text.length) {
        // End of the document, mark this as the end of the item
        currentItemEnd = text.length - 1;
        break;
      }
    }
  }
  return {
    from: currentItemStart,
    to: currentItemEnd,
    indentLevel,
  };
}

export async function foldCommand() {
  await editor.fold();
}

export async function unfoldCommand() {
  await editor.unfold();
}

export async function toggleFoldCommand() {
  await editor.toggleFold();
}

export async function foldAllCommand() {
  await editor.foldAll();
}

export async function unfoldAllCommand() {
  await editor.unfoldAll();
}
