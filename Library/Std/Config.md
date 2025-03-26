#meta

This defines the [JSON schema](https://json-schema.org/) for built-in settings.

```space-lua
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
        description = "Icon representing the action button"
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

```
