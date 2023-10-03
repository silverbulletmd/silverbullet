import { syscall } from "$sb/silverbullet-syscall/syscall.ts";

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
  return syscall("handlebars.renderTemplate", template, obj, globals);
}
