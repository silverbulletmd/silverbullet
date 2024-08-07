import type { AST } from "@silverbulletmd/silverbullet/lib/tree";
import { syscall } from "../syscall.ts";

/**
 * Renders a template with the given object and globals.
 * @param template the text of the template to render
 * @param obj the object to render the template with
 * @param globals the globals to render the template with
 * @returns the rendered template
 */
export function renderTemplate(
  template: string,
  obj: any,
  globals: Record<string, any> = {},
): Promise<string> {
  return syscall("template.renderTemplate", template, obj, globals);
}

/**
 * Parses a template into an AST.
 * @param template the text of the template to parse
 * @returns an AST representation of the template
 */
export function parseTemplate(
  template: string,
): Promise<AST> {
  return syscall("template.parseTemplate", template);
}
