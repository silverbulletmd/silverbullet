---
description: Defines the schemas and built-in values of built-in configuration options
tags: meta
---

SilverBullet uses the [config APIs](https://silverbullet.md/API/config) to manage its runtime configuration. You can set most of these anywhere in your space, but the convention is to use your [[CONFIG]] page for this purpose.

This meta page defines the JSON Schema of all built-in configuration settings, as well as their default values. You can override them by e.g. putting the following in your CONFIG page (use `space-lua` instead of `lua` in your actual page):

```lua
config.set("sync.documents", true)
```

# Built-in options (schema)

This defines the [JSON schema](https://json-schema.org/) for built-in configuration.

```space-lua
-- priority: 100

config.define("sync", {
  description = "Configure sync",
  type = "object",
  properties = {
    documents = {
      type = "boolean",
      default = false,
      description = "Sync document files (non-markdown) to the server",
      ui = { category = "Sync", label = "Sync documents", order = 1 },
    },
    -- In .gitignore format, either in a single string, or as a list of strings
    ignore = {
      oneOf = {
        schema.array "string",
        schema.string()
      }
    }
  },
  additionalProperties = false
})

config.define("index", {
  description = "Configure individual indexers",
  type = "object",
  properties = {
    paragraph = {
      type = "object",
      properties = {
        all = {
          type = "boolean",
          default = false,
          description = "Index paragraphs without a hashtag",
          ui = { category = "Indexing", label = "Index all paragraphs", order = 1 },
        },
      },
    },
    item = {
      type = "object",
      properties = {
        all = {
          type = "boolean",
          default = true,
          description = "Index items without a hashtag",
          ui = { category = "Indexing", label = "Index all items", order = 2 },
        },
      },
    },
    task = {
      type = "object",
      properties = {
        all = {
          type = "boolean",
          default = true,
          description = "Index tasks without a hashtag",
          ui = { category = "Indexing", label = "Index all tasks", order = 3 },
        },
      },
    },
  },
  additionalProperties = true
})

config.define("plugs", {
  description = "List of plugs to enable",
  oneOf = {
    schema.array "string",
    { -- only as a fallback for an empty table in Lua
      type = "object",
    }
  },
})


-- Editor configuration options
config.define("autoCloseBrackets", {
  description = "List of opening bracket characters to auto-close",
  type = "string",
  default = "([{",
  ui = { category = "Editor", label = "Auto-close brackets", order = 2 },
})

config.define("shortWikiLinks", {
  description = "Render wiki links to just the last segment, e.g. Person/John becomes John",
  type = "boolean",
  default = true,
  ui = { category = "Editor", label = "Short wiki links", order = 1 },
})

config.define("emoji", {
  description = "Additional emoji aliases",
  type = "object",
  properties = {
    aliases = {
      type = "object",
      additionalProperties = schema.string(),
    }
  }
})

config.define("smartQuotes", {
  description = "Configure smart quotes",
  type = "object",
  ui = { category = "Editor", label = "Smart quotes", order = 3 },
  properties = {
    enabled = {
      type = "boolean",
      description = "Indicates whether smart quotes are enabled",
      ui = { category = "Editor", label = "Enable smart quotes", order = 1 },
      default = true,
    },
    double = {
      type = "object",
      properties = {
        left = {
          type = "string",
          default = "“",
          description = "Character for the left double quote",
          ui = { category = "Editor", label = "Double quote left", order = 2 },
        },
        right = {
          type = "string",
          default = "”",
          description = "Character for the right double quote",
          ui = { category = "Editor", label = "Double quote right", order = 3 },
        }
      },
      additionalProperties = false
    },
    single = {
      type = "object",
      properties = {
        left = {
          type = "string",
          default = "‘",
          description = "Character for the left single quote",
          ui = { category = "Editor", label = "Single quote left", order = 4 },
        },
        right = {
          type = "string",
          default = "’",
          description = "Character for the right single quote",
          ui = { category = "Editor", label = "Single quote right", order = 5 },
        }
      },
      additionalProperties = false
    },
  },
  additionalProperties = false
})

config.define("mobileMenuStyle", {
  type = "string",
})

config.define("vim", {
  description = "Vim mode configuration",
  type = "object",
  properties = {
    unmap = {
      description = "Keys to unmap",
      type = "array",
      items = {
        oneOf = {
          { type = "string" },
          {
            type = "object",
            properties = {
              key = { type = "string" },
              mode = {
                type = "string",
                enum = {"normal", "insert", "visual"}
              }
            },
            required = { "key" },
            additionalProperties = false
          }
        }
      }
    },
    map = {
      description = "Custom mappings",
      type = "array",
      items = {
        type = "object",
        properties = {
          map = { type = "string" },
          to = { type = "string" },
          mode = {
            type = "string",
            enum = {"normal", "insert", "visual"}
          }
        },
        required = { "map", "to" },
        additionalProperties = false
      }
    },
    noremap = {
      description = "Non-recursive custom mappings",
      type = "array",
      items = {
        type = "object",
        properties = {
          map = { type = "string" },
          to = { type = "string" },
          mode = {
            type = "string",
            enum = {"normal", "insert", "visual"}
          }
        },
        required = { "map", "to" },
        additionalProperties = false
      }
    },
    commands = {
      description = "Custom Ex commands",
      type = "array",
      items = {
        type = "object",
        properties = {
          command = { type = "string" },
          ex = { type = "string" }
        },
        required = { "command", "ex" },
        additionalProperties = false
      }
    },
  },
  additionalProperties = false
})

-- Query specific configuration options
config.define("queryCollation", {
  description = "Configure string ordering in queries",
  type = "object",
  ui = { category = "Query", label = "Query collation", order = 1 },
  properties = {
    enabled = {
      type = "boolean",
      default = false,
      description = "Indicates whether string collation should be used instead of simple codepoint ordering",
      ui = { category = "Query", label = "Enable collation", order = 1 },
    },
    locale = {
      type = "string",
      description = "Language tag to specify sorting rules (from BCP 47)",
      ui = { category = "Query", label = "Locale", order = 2 },
    },
    options = {
      type = "object",
      description = "Additional options passed to Intl.Collator constructor"
      -- See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator/Collator#options
    },
  },
  additionalProperties = false
})

-- Configuration for internal use mostly

-- Don't use directly, use command.define instead
config.define("commands", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      contexts = schema.nullableArray "string",
      priority = schema.nullable "number",
      key = {
        anyOf = {
          schema.string(),
          schema.array("string"),
          schema.null()
        }
      },
      mac = {
        anyOf = {
          schema.string(),
          schema.array("string"),
          schema.null()
        }
      },
      hide = schema.nullable "boolean",
      requireMode = schema.nullable {
        type = "string", 
        enum = {"rw", "ro"},
      },
      requireEditor = schema.nullable("string"),
      run = schema.func(),
    },
  },
})

-- Don't use directly, use slashCommands.define instead
config.define("slashCommands", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      description = schema.nullable "string",
      priority = schema.nullable "number",
      onlyContexts = schema.nullableArray "string",
      exceptContexts = schema.nullableArray "string",
      run = schema.func(),
    },
  },
})

-- Don't use directly, use event.listen instead
config.define("eventHandlers", {
  type = "object",
  additionalProperties = schema.array(schema.func()),
})

-- Don't use directly, use mq.listen instead
config.define("mqSubscriptions", {
  type = "object",
  additionalProperties = {
    type = "array",
    items = {
      type = "object",
      properties = {
        batchSize = schema.number(),
        run = schema.func(),
      }
    }
  },
})

-- Task states
config.define("taskStates", {
  type = "object",
  default = {},
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      done = schema.nullable "boolean",
      order = schema.nullable "number",
    },
    required = {"name"},
  },
})

-- Don't use directly, WIP
config.define("tags", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      schema = schema.schema(),
      -- Whether or not an object HAS to validate to be indexed (defaults to false), has a performance penalty
      mustValidate = schema.boolean(),
      -- Additional custom validation logic
      validate = schema.func(),
      -- Invoked by the object indexer, takes a proposed object as input, returns an array of objects (can be empty table to skip indexing altogether)
      transform = schema.func(),
    },
  },
})

-- Don't use directly, use actionButton.define instead
config.define("actionButtons", {
  type = "array",
  items = {
    type = "object",
    properties = {
      icon = {
        type = "string",
        description = "Icon for the action button, from https://feathericons.com"
      },
      description = {
        type = "string",
        description = "Optional description of the action button"
      },
      command = {
        type = "string",
        description = "Optional command name to invoke when clicked (replaces run). The command's keyboard shortcut is automatically shown in the tooltip."
      },
      priority = {
        type = "number",
        description = "Optional priority: the higher the earlier the button will appear in the list"
      },
      mobile = {
        type = "boolean",
        description = "Optional boolean indicating if the action button is applicable for mobile"
      },
      standalone = {
        type = "boolean",
        description = "Optional: when set to true, button only appears in standalone/PWA mode; when false, only in browser mode"
      },
      dropdown = {
        type = "boolean",
        description = "Optional: set to false to keep this button outside the dropdown menu on mobile (default: true)"
      },
      run = schema.func(),
    },
    required = {"icon"},
    additionalProperties = false
  }
})
```

# Default values
Default values that cannot be expressed as schema defaults (e.g. because they contain functions).

```space-lua
-- priority: 99
config.set("actionButtons", {
  {
    icon = "home",
    description = "Go to the index page",
    command = "Navigate: Home",
    priority = 3,
    dropdown = false,
  },
  {
    icon = "book",
    description = "Open page",
    command = "Navigate: Page Picker",
    priority = 2,
    dropdown = false,
  },
  {
    icon = "terminal",
    description = "Run command",
    command = "Open Command Palette",
    priority = 1,
  },
  {
    icon = "chevron-left",
    description = "Go back",
    standalone = true,
    priority = 0,
    run = function()
      editor.goHistory(-1)
    end,
  },
  {
    icon = "chevron-right",
    description = "Go forward",
    standalone = true,
    priority = -1,
    run = function()
      editor.goHistory(1)
    end,
  }
})
```
