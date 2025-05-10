#meta

SilverBullet's configuration can be tweaked using the `config.set` Space Lua API. This page defines all built-in configurations available. Individual Plugs and Space Lua scripts may define their own.

# Built-in options
This defines the [JSON schema](https://json-schema.org/) for built-in configuration.

```space-lua
-- priority: 100
config.define("plugs", {
  description = "List of plugs to enable",
  oneOf = {
    {
      type = "array",
      items = { type = "string" }
    },
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
      additionalProperties = {  type = "string" }
    }
  }
})

config.define("shortcuts", {
  type = "array",
  items = {
    type = "object",
    properties = {
      command = {
        type = "string",
        description = "Command we're creating the shortcut for"
      },
      key = {
        type = "string",
        description = "(Re)bind to keyboard shortcut"
      },
      mac = {
        type = "string",
        description = "Mac-specific keyboard shortcut"
      },
      slashCommand = {
        type = "string",
        description = "Bind to slash command"
      },
      priority = {
        type = "number",
        description = "Tweak priority in command palette"
      }
    },
    required = {"command"},
    additionalProperties = false
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
        description = "Command the action button executes"
      },
      args = {
        type = "array",
        description = "Optional array of arguments for the command"
      },
      mobile = {
        type = "boolean",
        description = "Optional boolean indicating if the action button is applicable for mobile"
      }
    },
    required = {"icon", "command"},
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
