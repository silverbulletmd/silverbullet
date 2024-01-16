import { ObjectValue } from "$sb/types.ts";

/**
 * Used for creating new pages using {[Page: From Template]} command
 */
export type PageTemplate = {
  enabled?: boolean;

  // Suggested name for the new page, can use template placeholders
  suggestedName?: string;
  // Confirm the name before creating
  confirm?: boolean;

  // If the page already exists, open it instead of creating a new one
  openIfExists?: boolean;

  // Also expose this template as a command with optional key bindings
  command?: {
    name?: string;
    key?: string;
    mac?: string;
  };
};

export type SlashTemplate = {
  enabled?: boolean;

  name: string; // trigger
  // Regex match to apply (implicitly makes the body the regex replacement)
  match?: string;
};

export type TemplateHooks = {
  topBlock?: SideBlock;
  bottomBlock?: SideBlock;
  pageTemplate?: PageTemplate;
  slashTemplate?: SlashTemplate;
};

export type SideBlock = {
  enabled?: boolean;
  where?: string;
  priority?: number;
};

export type TemplateFrontmatter = {
  displayName?: string;
  description?: string;
  // Frontmatter can be encoded as an object (in which case we'll serialize it) or as a string
  frontmatter?: Record<string, any> | string;

  hooks?: TemplateHooks;
};

export type TemplateObject = ObjectValue<TemplateFrontmatter>;
