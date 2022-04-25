import {
  getCursor,
  getText,
  insertAtPos,
  replaceRange,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";

export async function toggleH1() {
  await togglePrefix("# ");
}

export async function toggleH2() {
  await togglePrefix("## ");
}

function lookBack(s: string, pos: number, backString: string): boolean {
  return s.substring(pos - backString.length, pos) === backString;
}

async function togglePrefix(prefix: string) {
  let text = await getText();
  let pos = await getCursor();
  if (text[pos] === "\n") {
    pos--;
  }
  while (pos > 0 && text[pos] !== "\n") {
    if (lookBack(text, pos, prefix)) {
      // Already has this prefix, let's flip it
      await replaceRange(pos - prefix.length, pos, "");
      return;
    }
    pos--;
  }
  if (pos) {
    pos++;
  }
  await insertAtPos(prefix, pos);
}
