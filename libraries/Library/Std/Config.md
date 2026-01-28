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
    -- Defaults to false
    documents = schema.boolean(),
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
        -- Index paragraphs without a hashtag
        all = schema.boolean(),
      },
    },
    item = {
      type = "object",
      properties = {
        -- Index items without a hashtag
        all = schema.boolean(),
      },
    },
    task = {
      type = "object",
      properties = {
        -- Index tasks without a hashtag
        all = schema.boolean(),
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
  description = "List of brackets to auto close",
  type = "string",
})

config.define("shortWikiLinks", {
  description = "Render wiki links to just the last segment, e.g. Person/John becomes John",
  type = "boolean"
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
  properties = {
    enabled = {
      type = "boolean",
      description = "Indicates whether smart quotes are enabled"
    },
    double = {
      type = "object",
      properties = {
        left = {
          type = "string",
          description = "Character for the left double quote"
        },
        right = {
          type = "string",
          description = "Character for the right double quote"
        }
      },
      additionalProperties = false
    },
    single = {
      type = "object",
      properties = {
        left = {
          type = "string",
          description = "Character for the left single quote"
        },
        right = {
          type = "string",
          description = "Character for the right single quote"
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
  properties = {
    enabled = {
      type = "boolean",
      description = "Indicates whether string collation should be used instead of simple codepoint ordering"
    },
    locale = {
      type = "string",
      description = "Language tag to specify sorting rules (from BCP 47)"
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
  additionalProperties = {
    type = "object",
    properties = {
      -- for future use
    },
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
      priority = {
        type = "number",
        description = "Optional priority: the higher the earlier the button will appear in the list"
      },
      mobile = {
        type = "boolean",
        description = "Optional boolean indicating if the action button is applicable for mobile"
      },
      run = schema.func(),
    },
    required = {"icon", "run"},
    additionalProperties = false
  }
})
```

# Default values
Default values for built-in configuration options.

```space-lua
-- priority: 99
config.set {
  index = {
    paragraph = { all = false },
    item = { all = true },
    task = { all = true },
  },
  taskStates = {},
  shortWikiLinks = true,
  actionButtons = {
    {
      icon = "home",
      description = "Go to the index page",
      priority = 3,
      run = function()
        editor.invokeCommand "Navigate: Home"
      end
    },
    {
      icon = "book",
      description = "Open page",
      priority = 2,
      run = function()
        editor.invokeCommand "Navigate: Page Picker"
      end
    },
    {
      icon = "terminal",
      description = "Run command",
      priority = 1,
      run = function()
        editor.invokeCommand "Open Command Palette"
      end,
    }
  },
}
```
