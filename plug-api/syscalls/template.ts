import { syscall } from "../syscall.ts";

/**
 * Renders
 * @param template
 * @param obj
 * @param globals
 * @returns
 */
export function renderTemplate(
  template: string,
  obj: any,
  globals: Record<string, any> = {},
): Promise<string> {
  return syscall("template.renderTemplate", template, obj, globals);
}

export function parseTemplate(
  template: string,
): Promise<string> {
  return syscall("template.parseTemplate", template);
}
