import { ObjectValue } from "$sb/types.ts";

export type TemplateFrontmatter = {
  displayName?: string;
  type?: "page";
  // Frontmatter can be encoded as an object (in which case we'll serialize it) or as a string
  frontmatter?: Record<string, any> | string;

  // Specific for slash templates
  trigger?: string;

  // Specific for frontmatter templates
  where?: string; // expression (SB query style)
  priority?: number; // When multiple templates match, the one with the highest priority is used
};

export type TemplateObject = ObjectValue<TemplateFrontmatter>;
