import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import {
  buildCommentScaffold,
  computeCommentInsertion,
} from "../../plug-api/lib/comments.ts";

async function resolveAuthor(): Promise<string | undefined> {
  const configured = await system.getConfig<string>("comments.author", "");
  return configured || undefined;
}

export async function addComment() {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  const author = await resolveAuthor();
  const r = computeCommentInsertion(text, selection.from, selection.to, {
    ...(author ? { author } : {}),
    date: new Date().toISOString().slice(0, 10),
  });
  await editor.replaceRange(r.insertAt, r.insertAt, r.text);
  await editor.moveCursor(r.cursorPos);
}

export async function insertCommentSlash() {
  const author = await resolveAuthor();
  const scaffold = buildCommentScaffold({
    ...(author ? { author } : {}),
    date: new Date().toISOString().slice(0, 10),
  });
  const selection = await editor.getSelection();
  await editor.replaceRange(selection.from, selection.from, scaffold.text);
  await editor.moveCursor(selection.from + scaffold.cursorOffset);
}
