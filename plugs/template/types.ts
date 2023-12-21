import { ObjectValue } from "$sb/types.ts";

export type TemplateFrontmatter = {
  trigger?: string; // slash command name
  displayName?: string;
  type?: "page";
  // Frontmatter can be encoded as an object (in which case we'll serialize it) or as a string
  frontmatter?: Record<string, any> | string;
};

export type TemplateObject = ObjectValue<TemplateFrontmatter>;
