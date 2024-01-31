import { system } from "../../plug-api/syscalls.ts";

export function renderTemplate(
  templateText: string,
  data: any = {},
  variables: Record<string, any> = {},
): Promise<{ frontmatter?: string; text: string }> {
  return system.invokeFunction(
    "template.renderTemplate",
    templateText,
    data,
    variables,
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
