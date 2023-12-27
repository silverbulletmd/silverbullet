import type { FilterOption } from "../../web/types.ts";
import { UploadFile } from "../types.ts";
import { syscall } from "./syscall.ts";

export function getCurrentPage(): Promise<string> {
  return syscall("editor.getCurrentPage");
}

export function setPage(newName: string): Promise<void> {
  return syscall("editor.setPage", newName);
}

export function getText(): Promise<string> {
  return syscall("editor.getText");
}

export function getCursor(): Promise<number> {
  return syscall("editor.getCursor");
}

export function getSelection(): Promise<{ from: number; to: number }> {
  return syscall("editor.getSelection");
}

export function setSelection(from: number, to: number): Promise<void> {
  return syscall("editor.setSelection", from, to);
}

export function save(): Promise<void> {
  return syscall("editor.save");
}

export function navigate(
  name: string,
  pos?: string | number,
  replaceState = false,
  newWindow = false,
): Promise<void> {
  return syscall("editor.navigate", name, pos, replaceState, newWindow);
}

export function reloadPage(): Promise<void> {
  return syscall("editor.reloadPage");
}

export function reloadUI(): Promise<void> {
  return syscall("editor.reloadUI");
}

export function openUrl(url: string, existingWindow = false): Promise<void> {
  return syscall("editor.openUrl", url, existingWindow);
}

// Force the client to download the file in dataUrl with filename as file name
export function downloadFile(filename: string, dataUrl: string): Promise<void> {
  return syscall("editor.downloadFile", filename, dataUrl);
}

export function uploadFile(
  accept?: string,
  capture?: string,
): Promise<UploadFile> {
  return syscall("editor.uploadFile", accept, capture);
}

export function flashNotification(
  message: string,
  type: "info" | "error" = "info",
): Promise<void> {
  return syscall("editor.flashNotification", message, type);
}

export function filterBox(
  label: string,
  options: FilterOption[],
  helpText = "",
  placeHolder = "",
): Promise<FilterOption | undefined> {
  return syscall("editor.filterBox", label, options, helpText, placeHolder);
}

export function showPanel(
  id: "lhs" | "rhs" | "bhs" | "modal",
  mode: number,
  html: string,
  script = "",
): Promise<void> {
  return syscall("editor.showPanel", id, mode, html, script);
}

export function hidePanel(
  id: "lhs" | "rhs" | "bhs" | "modal",
): Promise<void> {
  return syscall("editor.hidePanel", id);
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

export function insertAtCursor(text: string): Promise<void> {
  return syscall("editor.insertAtCursor", text);
}

export function dispatch(change: any): Promise<void> {
  return syscall("editor.dispatch", change);
}

export function prompt(
  message: string,
  defaultValue = "",
): Promise<string | undefined> {
  return syscall("editor.prompt", message, defaultValue);
}

export function confirm(
  message: string,
): Promise<boolean> {
  return syscall("editor.confirm", message);
}
export function getUiOption(key: string): Promise<any> {
  return syscall("editor.getUiOption", key);
}

export function setUiOption(key: string, value: any): Promise<void> {
  return syscall("editor.setUiOption", key, value);
}

// Vim specific
export function vimEx(exCommand: string): Promise<any> {
  return syscall("editor.vimEx", exCommand);
}

// Folding

export function fold() {
  return syscall("editor.fold");
}

export function unfold() {
  return syscall("editor.unfold");
}

export function toggleFold() {
  return syscall("editor.toggleFold");
}

export function foldAll() {
  return syscall("editor.foldAll");
}

export function unfoldAll() {
  return syscall("editor.unfoldAll");
}
