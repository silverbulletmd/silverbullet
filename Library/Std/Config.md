#meta

SilverBullet's configuration can be tweaked using the `config.set` Space Lua API. This page defines all built-in
configurations available. Individual Plugs and Space Lua scripts may define their own.

# Built-in options (schema)

This defines the [JSON schema](https://json-schema.org/) for built-in configuration.

```space-lua
-- priority: 100
config.define("plugs", {
  description = "List of plugs to enable",
  oneOf = {
    schema.array "string",
    { -- only as a fallback for an empty table in Lua
      type = "object",
    }
  },
})

config.define("autoCloseBrackets", {
  description = "List of brackets to auto close",
  type = "string",
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

config.define("commands", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      contexts = schema.nullableArray "string",
      priority = schema.nullable "number",
      key = schema.nullable "string",
      mac = schema.nullable "string",
      hid = schema.nullable "boolean",
      requireMode = schema.nullable {
        type = "string", 
        enum = {"rw", "ro"},
      },
      requireEditor = schema.nullable("string"),
      run = schema.func(),
    },
  },
})

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

config.define("eventHandlers", {
  type = "object",
  additionalProperties = schema.array(schema.func()),
})

config.define("tagDefinitions", {
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      schema = { type = "object" },
      metatable = { },
    },
  },
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
```

Some default values

```space-lua
-- priority: 99
config.set {
  actionButtons = {
    {
      icon = "home",
      description = "Go to the index page",
      priority = 3,
      run = function()
        editor.invokeCommand("Navigate: Home")
      end
    },
    {
      icon = "book",
      description = "Open page",
      priority = 2,
      run = function()
        editor.invokeCommand("Navigate: Page Picker")
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