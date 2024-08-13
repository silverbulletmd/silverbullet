import type { ActionButton, EmojiConfig, Shortcut } from "./client.ts";

export type ObjectDecorator = {
  // The expression to match against the object
  where: string;
  // The dynamic attributes to add to the object
  attributes: DynamicAttributeDefinitionConfig;
};

export interface DynamicAttributeDefinitionConfig {
  // Encodes a QueryExpression as a string
  [key: string]: string | DynamicAttributeDefinitionConfig;
}

export type LibraryDef = {
  /**
   * @deprecated Use `import` instead
   */
  source?: string;
  import: string;
  exclude?: string[];
};

export type Config = {
  indexPage: string;
  shortcuts?: Shortcut[];
  useSmartQuotes?: boolean;
  maximumAttachmentSize?: number;
  libraries?: LibraryDef[];
  // Open the last page that was open when the app was closed
  pwaOpenLastPage?: boolean;
  // UI visuals
  hideEditButton?: boolean;
  hideSyncButton?: boolean;
  actionButtons: ActionButton[];
  objectDecorators?: ObjectDecorator[];
  // Format: compatible with docker ignore
  spaceIgnore?: string;
  emoji?: EmojiConfig;

  // DEPRECATED: Use space styles instead
  customStyles?: string | string[];

  // NOTE: Bit niche, maybe delete at some point?
  defaultLinkStyle?: string;
} & Record<string, any>;

export const ConfigSchema = {
  type: "object",
  properties: {
    indexPage: { type: "string" },
    shortcuts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          key: { type: "string", nullable: true },
          mac: { type: "string", nullable: true },
          slashCommand: { type: "string", nullable: true },
          priority: { type: "number", nullable: true },
        },
        required: ["command"],
      },
      nullable: true,
    },
    useSmartQuotes: { type: "boolean", nullable: true },
    maximumAttachmentSize: { type: "number", nullable: true },
    pwaOpenLastPage: { type: "boolean", nullable: true },
    hideEditButton: { type: "boolean", nullable: true },
    hideSyncButton: { type: "boolean", nullable: true },
    libraries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          import: { type: "string" },
          exclude: {
            type: "array",
            items: { type: "string" },
            nullable: true,
          },
        },
        required: ["import"],
      },
      nullable: true,
    },
    actionButtons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          icon: { type: "string" },
          description: { type: "string", nullable: true },
          command: { type: "string" },
          args: {
            type: "array",
            items: { type: "object" },
            nullable: true,
          },
          mobile: { type: "boolean", nullable: true },
        },
        required: ["icon", "command"],
      },
    },
    objectDecorators: {
      type: "array",
      items: {
        type: "object",
        required: ["where", "attributes"],
      },
      nullable: true,
    },
    spaceIgnore: { type: "string", nullable: true },
    emoji: {
      type: "object",
      properties: {
        aliases: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
      },
      required: ["aliases"],
      nullable: true,
    },
    customStyles: {
      anyOf: [
        { type: "string" },
        {
          type: "array",
          items: { type: "string" },
        },
        { type: "null" },
      ],
    },
    defaultLinkStyle: { type: "string", nullable: true },
  },
  additionalProperties: true,
  required: [],
};
