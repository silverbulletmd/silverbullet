import type { ObjectValue } from "@silverbulletmd/silverbullet/types";

export type CommandConfig = {
  command?: string;
  key?: string;
  mac?: string;
};

/**
 * Used for creating new pages using {[Page: From Template]} command
 */
export type NewPageConfig = CommandConfig & {
  // Suggested name for the new page, can use template placeholders
  suggestedName?: string;
  // Suggest (or auto use) this template for a specific prefix
  forPrefix?: string;
  // Confirm the name before creating
  confirmName?: boolean;
  // If the page already exists, open it instead of creating a new one
  openIfExists?: boolean;
};

/**
 * Represents a snippet
 */
export type SnippetConfig = CommandConfig & {
  slashCommand: string; // trigger
  order?: number; // order in the list
  // Regex match to apply (implicitly makes the body the regex replacement)
  matchRegex?: string;
  // Deprecated: use matchRegex instead (for backwards compatibility)
  match?: string;
  insertAt?: "cursor" | "line-start" | "line-end" | "page-start" | "page-end"; // defaults to cursor
};

export type WidgetConfig = {
  where: string;
  order?: number;
};

export type HooksConfig = {
  top?: WidgetConfig;
  bottom?: WidgetConfig;
  newPage?: NewPageConfig;
  snippet?: SnippetConfig;
};

export type FrontmatterConfig = {
  // Used for matching in page navigator
  displayName?: string;
  tags?: string | string[];

  // For use in the template selector slash commands and other avenues
  description?: string;
  // Frontmatter can be encoded as an object (in which case we'll serialize it) or as a string
  frontmatter?: Record<string, unknown> | string;

  hooks?: HooksConfig;
};

export type TemplateObject = ObjectValue<FrontmatterConfig>;
import type { JSONSchemaType } from "ajv";

export const CommandConfigSchema: JSONSchemaType<CommandConfig> = {
  type: "object",
  properties: {
    command: { type: "string", nullable: true },
    key: { type: "string", nullable: true },
    mac: { type: "string", nullable: true },
  },
  required: [],
  additionalProperties: false,
};

export const NewPageConfigSchema: JSONSchemaType<NewPageConfig> = {
  type: "object",
  properties: {
    command: { type: "string", nullable: true },
    key: { type: "string", nullable: true },
    mac: { type: "string", nullable: true },
    suggestedName: { type: "string", nullable: true },
    forPrefix: { type: "string", nullable: true },
    confirmName: { type: "boolean", nullable: true },
    openIfExists: { type: "boolean", nullable: true },
  },
  required: [],
  additionalProperties: false,
};

export const SnippetConfigSchema: JSONSchemaType<SnippetConfig> = {
  type: "object",
  properties: {
    command: { type: "string", nullable: true },
    key: { type: "string", nullable: true },
    mac: { type: "string", nullable: true },
    slashCommand: { type: "string" },
    order: { type: "number", nullable: true },
    matchRegex: { type: "string", nullable: true },
    match: { type: "string", nullable: true },
    insertAt: {
      type: "string",
      enum: [
        "cursor",
        "line-start",
        "line-end",
        "page-start",
        "page-end",
      ],
      nullable: true,
    },
  },
  required: ["slashCommand"],
  additionalProperties: false,
};

export const WidgetConfigSchema: JSONSchemaType<WidgetConfig> = {
  type: "object",
  properties: {
    where: { type: "string" },
    order: { type: "number", nullable: true },
  },
  required: ["where"],
  additionalProperties: false,
};

export const HooksConfigSchema: JSONSchemaType<HooksConfig> = {
  type: "object",
  properties: {
    top: {
      type: "object",
      properties: WidgetConfigSchema.properties,
      required: ["where"],
      nullable: true,
    },
    bottom: {
      type: "object",
      properties: WidgetConfigSchema.properties,
      required: ["where"],
      nullable: true,
    },
    newPage: {
      type: "object",
      properties: NewPageConfigSchema.properties,
      required: [],
      nullable: true,
    },
    snippet: {
      type: "object",
      properties: SnippetConfigSchema.properties,
      required: ["slashCommand"],
      nullable: true,
    },
  },
  required: [],
  additionalProperties: false,
};

export const FrontmatterConfigSchema = {
  type: "object",
  properties: {
    displayName: { type: "string", nullable: true },
    tags: {
      oneOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
        { type: "null" },
      ],
    },
    description: { type: "string", nullable: true },
    frontmatter: {
      oneOf: [
        { type: "object", additionalProperties: true },
        { type: "string" },
        { type: "null" },
      ],
    },
    hooks: {
      type: "object",
      properties: HooksConfigSchema.properties,
      required: [],
      nullable: true,
    },
  },
  required: [],
  additionalProperties: true,
};

export const TemplateObjectSchema = {
  type: "object",
  properties: {
    displayName: { type: "string", nullable: true },
    tags: {
      oneOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
        { type: "null" },
      ],
    },
    description: { type: "string", nullable: true },
    frontmatter: {
      oneOf: [
        { type: "object", additionalProperties: true },
        { type: "string" },
        { type: "null" },
      ],
    },
    hooks: {
      type: "object",
      properties: HooksConfigSchema.properties,
      required: [],
      nullable: true,
    },
  },
  additionalProperties: true,
};
