import type { CodeWidgetContent } from "../types.ts";
import { syscall } from "../syscall.ts";

/**
 * Renders a code widget.
 * @param lang the language of the fenced code block
 * @param body the body of the code to render
 * @param pageName the name of the page the code widget appears on
 * @returns the rendered code widget content
 */
export function render(
  lang: string,
  body: string,
  pageName: string,
): Promise<CodeWidgetContent | null> {
  return syscall("codeWidget.render", lang, body, pageName);
}

/**
 * Refreshes all code widgets on the page that support it.
 */
export function refreshAll(): Promise<void> {
  return syscall("codeWidget.refreshAll");
}
