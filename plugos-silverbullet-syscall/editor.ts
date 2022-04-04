import {syscall} from "./syscall";

export function getCurrentPage(): Promise<string> {
  return syscall("editor.getCurrentPage");
}

export function getText(): Promise<string> {
  return syscall("editor.getText");
}

export function getCursor(): Promise<number> {
  return syscall("editor.getCursor");
}

export function save(): Promise<void> {
  return syscall("editor.save");
}

export function navigate(name: string, pos?: number): Promise<void> {
  return syscall("editor.navigate", name, pos);
}

export function reloadPage(): Promise<void> {
  return syscall("editor.reloadPage");
}

export function openUrl(url: string): Promise<void> {
  return syscall("editor.openUrl", url);
}

export function flashNotification(message: string): Promise<void> {
  return syscall("editor.flashNotification", message);
}

export function showRhs(html: string): Promise<void> {
  return syscall("editor.showRhs", html);
}

export function hideRhs(): Promise<void> {
  return syscall("editor.hideRhs");
}

export function insertAtPos(text: string, pos: number): Promise<void> {
  return syscall("editor.insertAtPos", text, pos);
}

export function replaceRange(
  from: number,
  to: number,
  text: string
): Promise<void> {
  return syscall("editor.replaceRange", from, to, text);
}

export function moveCursor(pos: number): Promise<void> {
  return syscall("editor.moveCursor", pos);
}

export function insertAtCursor(text: string): Promise<void> {
  return syscall("editor.insertAtCursor", text);
}

export function matchBefore(
  re: string
): Promise<{ from: number; to: number; text: string } | null> {
  return syscall("editor.matchBefore", re);
}

export function dispatch(change: any): Promise<void> {
  return syscall("editor.dispatch", change);
}

export function prompt(
  message: string,
  defaultValue = ""
): Promise<string | undefined> {
  return syscall("editor.prompt", message, defaultValue);
}
