import type { PageMeta } from "$sb/types.ts";
import { system } from "../../plug-api/syscalls.ts";

export function renderTemplate(
  templateText: string,
  pageMeta: PageMeta,
  data: any = {},
): Promise<{ frontmatter?: string; text: string }> {
  return system.invokeFunction(
    "template.renderTemplate",
    templateText,
    pageMeta,
    data,
  );
}

export function cleanTemplate(
  templateText: string,
): Promise<string> {
  return system.invokeFunction(
    "template.cleanTemplate",
    templateText,
  );
}
