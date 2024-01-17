import { ObjectValue } from "$sb/types.ts";

export type TemplateCommand = {
  name?: string;
  key?: string;
  mac?: string;
};

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
  command?: TemplateCommand;
};

/**
 * Represents a snippet
 */
export type SnippetTemplate = {
  enabled?: boolean;

  name: string; // trigger
  // Regex match to apply (implicitly makes the body the regex replacement)
  matchRegex?: string;

  insertAt?: "cursor" | "line-start" | "line-end" | "page-start" | "page-end"; // defaults to cursor

  command?: TemplateCommand;
};

export type TemplateHooks = {
  topBlock?: BlockTemplate;
  bottomBlock?: BlockTemplate;
  pageTemplate?: PageTemplate;
  snippetTemplate?: SnippetTemplate;
};

export type BlockTemplate = {
  enabled?: boolean;
  where?: string;
  priority?: number;
};

export type TemplateFrontmatter = {
  // Used for matching in page navigator
  displayName?: string;

  // For use in the template selector slash commands and other avenues

  description?: string;
  // Frontmatter can be encoded as an object (in which case we'll serialize it) or as a string
  frontmatter?: Record<string, any> | string;

  hooks?: TemplateHooks;
};

export type TemplateObject = ObjectValue<TemplateFrontmatter>;
