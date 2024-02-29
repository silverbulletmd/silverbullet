import { ObjectValue } from "../../plug-api/types.ts";
import { z, ZodEffects } from "zod";

export const CommandConfig = z.object({
  command: z.string().optional(),
  key: z.string().optional(),
  mac: z.string().optional(),
});

export type CommandConfig = z.infer<typeof CommandConfig>;

/**
 * Used for creating new pages using {[Page: From Template]} command
 */
export const NewPageConfig = refineCommand(
  z.object({
    // Suggested name for the new page, can use template placeholders
    suggestedName: z.string().optional(),
    // Suggest (or auto use) this template for a specific prefix
    forPrefix: z.string().optional(),
    // Confirm the name before creating
    confirmName: z.boolean().optional(),
    // If the page already exists, open it instead of creating a new one
    openIfExists: z.boolean().optional(),
  }).strict().merge(CommandConfig),
);

export type NewPageConfig = z.infer<typeof NewPageConfig>;

/**
 * Represents a snippet
 */

export const SnippetConfig = refineCommand(
  z.object({
    slashCommand: z.string(), // trigger
    order: z.number().optional(), // order in the list
    // Regex match to apply (implicitly makes the body the regex replacement)
    matchRegex: z.string().optional(),
    // Deprecated: use matchRegex instead (for backwards compatibility)
    match: z.string().optional(),
    insertAt: z.enum([
      "cursor",
      "line-start",
      "line-end",
      "page-start",
      "page-end",
    ]).optional(), // defaults to cursor
  }).strict().merge(CommandConfig),
);

/**
 * Ensures that 'command' is present if either 'key' or 'mac' is present for a particular object
 * @param o object to 'refine' with this constraint
 * @returns
 */
function refineCommand<T extends typeof CommandConfig>(o: T): ZodEffects<T> {
  return o.refine((data) => {
    // Check if either 'key' or 'mac' is present
    const hasKeyOrMac = data.key !== undefined || data.mac !== undefined;
    // Ensure 'command' is present if either 'key' or 'mac' is present
    return !hasKeyOrMac || data.command !== undefined;
  }, {
    message:
      "Attribute 'command' is required when specifying a key binding via 'key' and/or 'mac'.",
  });
}

export type SnippetConfig = z.infer<typeof SnippetConfig>;

export const WidgetConfig = z.object({
  where: z.string(),
  priority: z.number().optional(),
});

export type WidgetConfig = z.infer<typeof WidgetConfig>;

export const HooksConfig = z.object({
  top: WidgetConfig.optional(),
  bottom: WidgetConfig.optional(),
  newPage: NewPageConfig.optional(),
  snippet: SnippetConfig.optional(),
}).strict();

export type HooksConfig = z.infer<typeof HooksConfig>;

export const FrontmatterConfig = z.object({
  // Used for matching in page navigator
  displayName: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),

  // For use in the template selector slash commands and other avenues

  description: z.string().optional(),
  // Frontmatter can be encoded as an object (in which case we'll serialize it) or as a string
  frontmatter: z.union([z.record(z.unknown()), z.string()]).optional(),

  hooks: HooksConfig.optional(),
});

export type FrontmatterConfig = z.infer<typeof FrontmatterConfig>;

export type TemplateObject = ObjectValue<FrontmatterConfig>;
