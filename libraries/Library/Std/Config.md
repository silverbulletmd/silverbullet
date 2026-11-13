---
description: Defines the schemas and built-in values of built-in configuration options
---
SilverBullet uses the [config APIs](https://docs.silverbullet.md/API/config) to manage its runtime configuration. You can set most of these anywhere in your space, but the convention is to use your `Library/Config` page for this purpose.

This tool page defines the JSON Schema of all built-in configuration settings, as well as their default values. You can override them by e.g. putting the following in your `Library/Config` page (use `space-lua` instead of `lua` in your actual page):

```lua
config.set("sync.documents", true)
```

# Built-in options (schema)

This defines the [JSON schema](https://json-schema.org/) for built-in configuration.

```space-lua
-- priority: 100
-- boot: true

-- UI categories for the configuration manager, listed in display order.
config.defineCategory {
  name = "Appearance",
  description = "Theme and fonts for the interface, the editor and code.",
  priority = 60,
}
config.defineCategory {
  name = "Editor",
  description = "Behavior of the page editor: brackets, wiki link rendering, emoji aliases, and similar editing affordances.",
  priority = 50,
}
config.defineCategory {
  name = "Smart Quotes",
  description = "Replace straight quotes with typographic ones as you type, and pick which characters are used.",
  priority = 40,
}
config.defineCategory {
  name = "Sync",
  description = "Control how this client synchronizes pages and documents with the server.",
  priority = 30,
}
config.defineCategory {
  name = "Indexing",
  description = "Choose which kinds of content (paragraphs, items, tasks) are indexed for queries.",
  priority = 20,
}
config.defineCategory {
  name = "Query",
  description = "Configure how queries collate and compare strings, including locale-aware sorting.",
  priority = 10,
}

config.define("sync", {
  description = "Configure sync",
  type = "object",
  properties = {
    documents = {
      type = "boolean",
      default = false,
      description = "Sync document files (non-markdown) locally from the server. Allows access to document files while offline.",
      ui = { category = "Sync", label = "Sync documents", priority = 1 },
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
          ui = { category = "Indexing", label = "Index all paragraphs", priority = 3 },
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
          ui = { category = "Indexing", label = "Index all items", priority = 2 },
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
          ui = { category = "Indexing", label = "Index all tasks", priority = 1 },
        },
      },
    },
  },
  additionalProperties = true
})

-- Fonts are picked by key from fonts.available, which Std and font libraries
-- extend with config.set("fonts.available.<key>", {...}). A value that is not
-- a key is used as a CSS font-family stack. editor has no default so a
-- theme's suggestion can apply when a space sets none. The interface font is
-- the theme's.
local fontEntrySchema = {
  type = "object",
  properties = {
    name = schema.string(),
    family = schema.string(),
    kind = { type = "string", enum = { "sans", "serif", "mono" } },
    faces = {
      type = "array",
      items = {
        type = "object",
        properties = {
          src = schema.string(),
          weight = schema.nullable "number",
          style = schema.nullable "string",
        },
        required = { "src" },
      },
    },
    license = schema.nullable "string",
  },
  required = { "name", "family", "kind" },
}

config.define("theme", {
  type = "string",
  description = "Theme for everyone using this space. Each device can pick its own with Theme: Select",
  ui = { category = "Appearance", label = "Theme", priority = 5, theme = true },
})

config.define("accentColor", {
  type = "string",
  description = "Accent color for links, buttons, checkboxes and selections, on top of the theme's. Any CSS color, such as #c2410c. Leave empty for the theme's own.",
  ui = { category = "Appearance", label = "Accent color", priority = 5, color = true },
})

config.define("fonts", {
  type = "object",
  properties = {
    ui = {
      type = "string",
      description = "No longer used: the interface font comes from the theme. Kept so older configuration still validates",
    },
    editor = {
      type = "string",
      description = "Font for page text in the editor: a font from the list, or a CSS font-family",
      ui = { category = "Appearance", label = "Editor font", priority = 3, font = "editor" },
    },
    editorSize = {
      type = "number",
      minimum = 10,
      maximum = 48,
      description = "Size of page text in the editor, in pixels; headings and code scale with it",
      ui = { category = "Appearance", label = "Editor font size", priority = 2, fontSize = true },
    },
    code = {
      type = "string",
      description = "Monospace font for code, frontmatter, tables being edited and Lua expressions",
      ui = { category = "Appearance", label = "Code font", priority = 1, font = "code" },
    },
    available = {
      type = "object",
      default = {},
      description = "Fonts to choose from, by key. Font libraries add to this",
      additionalProperties = fontEntrySchema,
    },
  },
})

-- Built in: bundled with the client or provided by the operating system, so
-- none of these need faces.
config.set("fonts.available.ia-writer-mono", {
  name = "iA Writer Mono", family = "'iA-Mono', Menlo, monospace", kind = "mono", license = "OFL-1.1",
})
config.set("fonts.available.inter", {
  name = "Inter", family = "Inter, system-ui, sans-serif", kind = "sans", license = "OFL-1.1",
})
config.set("fonts.available.lora", {
  name = "Lora", family = "Lora, Georgia, serif", kind = "serif", license = "OFL-1.1",
})
config.set("fonts.available.system-sans", {
  name = "System sans", family = "system-ui, sans-serif", kind = "sans",
})
config.set("fonts.available.system-serif", {
  name = "System serif", family = "ui-serif, Georgia, serif", kind = "serif",
})
config.set("fonts.available.system-mono", {
  name = "System mono", family = "ui-monospace, Menlo, monospace", kind = "mono",
})

config.define("autoCloseBrackets", {
  description = "List of opening bracket characters to auto-close",
  type = "string",
  default = "([{",
})

config.define("shortWikiLinks", {
  description = "Render wiki links to just the last segment, e.g. Person/John becomes John",
  type = "boolean",
  default = true,
  ui = { category = "Editor", label = "Short wiki links", priority = 1 },
})

config.define("lint.inactiveBlocks", {
  description = "Warn about space-lua and space-style blocks on pages outside Library/, where they are not loaded",
  type = "boolean",
  default = true,
  ui = { category = "Editor", label = "Warn about scripts outside Library/" },
})

config.define("linkWriteFormat", {
  description = "How SilverBullet writes wiki links it generates: 'shortest' uses the bare page name when that name is unique in the space and the full path when it is not, 'shortest-suffix' writes the shortest path suffix that still uniquely identifies the page instead of the full path, 'full-path' always writes the full path",
  type = "string",
  enum = { "shortest", "shortest-suffix", "full-path" },
  default = "full-path",
  ui = { category = "Editor", label = "Link write format", priority = 2 },
})

config.define("liveEdit", {
  description = "Edit YAML as a form in the editor",
  type = "object",
  properties = {
    frontmatter = {
      type = "boolean",
      default = true,
      description = "Show page frontmatter as an editable form. When off, frontmatter is plain YAML; a tag's own renderFrontmatter still applies",
      ui = { category = "Editor", label = "Edit frontmatter as a form", priority = 0 },
    },
    dataBlocks = {
      type = "boolean",
      default = true,
      description = "Show data blocks (```#tag and ```data) as editable forms. When off, they are plain YAML; a tag's own renderDataBlock or a code widget still applies",
      ui = { category = "Editor", label = "Edit data blocks as a form", priority = -1 },
    },
  },
  additionalProperties = false,
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
      description = "Indicates whether smart quotes are enabled",
      ui = { category = "Smart Quotes", label = "Enable smart quotes", priority = 5 },
      default = true,
    },
    double = {
      type = "object",
      properties = {
        left = {
          type = "string",
          default = "“",
          description = "Character for the left double quote",
          ui = { category = "Smart Quotes", label = "Double quote left", priority = 4 },
        },
        right = {
          type = "string",
          default = "”",
          description = "Character for the right double quote",
          ui = { category = "Smart Quotes", label = "Double quote right", priority = 3 },
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
          ui = { category = "Smart Quotes", label = "Single quote left", priority = 2 },
        },
        right = {
          type = "string",
          default = "’",
          description = "Character for the right single quote",
          ui = { category = "Smart Quotes", label = "Single quote right", priority = 1 },
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
                enum = {"normal", "insert", "visual", "operator"}
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
            enum = {"normal", "insert", "visual", "operator"}
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
            enum = {"normal", "insert", "visual", "operator"}
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
  ui = { category = "Query", label = "Query collation", priority = 1 },
  properties = {
    enabled = {
      type = "boolean",
      default = false,
      description = "Indicates whether string collation should be used instead of simple codepoint ordering",
      ui = { category = "Query", label = "Enable collation", priority = 2 },
    },
    locale = {
      type = "string",
      description = "Language tag to specify sorting rules (from BCP 47)",
      ui = { category = "Query", label = "Locale", priority = 1 },
    },
    options = {
      type = "object",
      description = "Additional options passed to Intl.Collator constructor"
      -- See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator/Collator#options
    },
  },
  additionalProperties = false
})


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
      opensInput = schema.nullable "boolean",
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
      displayName = schema.nullable "string",
      description = schema.nullable "string",
      icon = schema.nullable "string",
      aliases = schema.nullableArray "string",
      group = schema.nullable "string",
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

config.define("identities", {
  type = "object",
  default = {},
  additionalProperties = {
    type = "object",
    properties = {
      name = schema.string(),
      description = schema.nullable "string",
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
      -- Feather icon name for how the tag itself is shown (Workbench)
      icon = schema.string(),
      schema = schema.schema(),
      -- Whether or not an object HAS to validate to be indexed (defaults to false), has a performance penalty
      mustValidate = schema.boolean(),
      -- Page decoration defaults for every page with this tag
      pageDecoration = schema.object(),
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
        description = "Icon for the action button, from https://feathericons.com. The name 'profile' is reserved for the account menu."
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
      accountManaged = {
        type = "boolean",
        description = "Optional: when true, button only appears on servers that manage accounts (multi-space)"
      },
      readOnly = {
        type = "boolean",
        description = "Optional: when set to true, button only appears in a read-only space; when false, only in an editable one"
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

local function markupButtonSchema(extra)
  local properties = {
    icon = {
      type = "string",
      description = "Icon name: a Feather icon (https://feathericons.com) or one of the md-* editor icons"
    },
    description = schema.string(),
    command = {
      type = "string",
      description = "Command to run when tapped (replaces run)"
    },
    run = schema.func(),
    onlyContexts = schema.nullableArray "string",
    exceptContexts = schema.nullableArray "string",
  }
  for k, v in pairs(extra or {}) do
    properties[k] = v
  end
  return {
    type = "object",
    properties = properties,
    required = {"icon"},
    additionalProperties = false
  }
end

-- The line menu's buttons also take a submenu group and a tick
local lineButtonSchema = markupButtonSchema {
  group = { type = "string", description = "Buttons with the same group share one submenu row, labeled with it" },
  activeContexts = schema.nullableArray "string",
}

config.define("markupBar", {
  description = "The markup bar: buttons for editing, shown above the keyboard on touch devices and, on desktop, in the formatting bubble and the line handle menu. Each has its own list, in display order. Each device can also hide them with Editor: Toggle Markup Bar. See [[^Library/Std/APIs/Markup Bar]].",
  type = "object",
  properties = {
    selectionBubble = {
      type = "boolean",
      default = true,
      description = "Show a formatting bubble over selected text (desktop)",
      ui = { category = "Editor", label = "Show a formatting bubble over selected text (desktop)", priority = -2 },
    },
    lineHandle = {
      type = "boolean",
      default = true,
      description = "Show the ⋮ line actions handle beside lines of text in the left margin (desktop). When off, its Add tag entry goes too; widgets keep their ⋮ menu",
      ui = { category = "Editor", label = "Show the ⋮ line actions handle in the left margin (desktop)", priority = -3 },
    },
    mobile = {
      type = "array",
      description = "The bar above the keyboard on phones and tablets, in order. Set to an empty list to hide it",
      items = markupButtonSchema(),
    },
    selection = {
      type = "array",
      description = "The formatting bubble over selected text on desktop, in order. Set to an empty list to hide it",
      items = markupButtonSchema(),
    },
    line = {
      type = "array",
      description = "The menu of the ⋮ line handle on desktop, in order",
      items = lineButtonSchema,
    },
  },
  additionalProperties = false,
})

config.define("keyboardBar", {
  description = "Deprecated: use markupBar.mobile. When a space sets this, the bar above the keyboard uses it instead of markupBar.mobile. See [[^Library/Std/APIs/Markup Bar]].",
  type = "array",
  items = markupButtonSchema(),
})

config.define("workbench.pinnedTags", {
  description = "Tags pinned at the top of the Workbench Data tab, in order.",
  type = "array",
  items = schema.string(),
  default = {"page", "task"},
})

config.define("view.defaults", {
  description = "Per-view presentation defaults, keyed by view name.",
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      dock = { type = "string", enum = {"modal", "lhs", "rhs", "bhs", "page-top", "page-bottom"} },
      open = { type = "boolean" },
      collapsed = { type = "boolean" },
      width = { type = "number", minimum = 160, maximum = 600 },
      height = { type = "number", minimum = 160 },
    },
    additionalProperties = false,
  },
})
```

# Default values
Default values that cannot be expressed as schema defaults (e.g. because they contain functions).

```space-lua
-- priority: 99
-- boot: true
config.set("actionButtons", {
  {
    icon = "home",
    description = "Go to the index page",
    command = "Navigate: Home",
    priority = 3,
    dropdown = false,
  },
  {
    icon = "search",
    description = "Search",
    command = "Space: Search",
    priority = 2.8,
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
    icon = "tool",
    description = "Toggle the Workbench",
    command = "Workbench: Toggle",
    priority = 0.5,
    readOnly = false,
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
  },
  {
    icon = "profile",
    description = "Account",
    accountManaged = true,
    priority = -2,
  },
})

-- Inserts a character that opens completion (`#`, `/`), separated from a
-- preceding word so the completer recognizes it. Local to this bootstrap page
-- so the default buttons work before the index has loaded any other Lua.
local function insertCompletionTrigger(char)
  local pos = editor.getCursor()
  if string.match(string.sub(editor.getText(), pos, pos), "[%w_]") then
    char = " " .. char
  end
  editor.insertAtCursor(char)
  editor.startCompletion()
end

-- The bar above the keyboard on phones and tablets, in this order
config.set("markupBar.mobile", {
  { icon = "md-format-list-bulleted", description = "Turn into bullet item", command = "Text: Listify Selection", exceptContexts = {"ListItem", "FencedCode", "FrontMatter"} },
  { icon = "md-checklist", description = "Turn into task", command = "Text: Taskify Line", exceptContexts = {"ListItem", "FencedCode", "FrontMatter"} },
  { icon = "md-format-indent-decrease", description = "Outdent", command = "Outline: Move Left", onlyContexts = {"ListItem"} },
  { icon = "md-format-indent-increase", description = "Indent", command = "Outline: Move Right", onlyContexts = {"ListItem"} },
  { icon = "md-checklist", description = "Turn into task", command = "Text: Taskify Line", onlyContexts = {"ListItem"}, exceptContexts = {"Task"} },
  { icon = "check-square", description = "Cycle task state", command = "Task: Cycle State", onlyContexts = {"Task"} },
  { icon = "arrow-up", description = "Move up", command = "Outline: Move Up", onlyContexts = {"ListItem"} },
  { icon = "arrow-down", description = "Move down", command = "Outline: Move Down", onlyContexts = {"ListItem"} },
  { icon = "chevrons-right", description = "Tab", command = "Editor: Indent", onlyContexts = {"FencedCode"} },
  { icon = "chevrons-left", description = "Shift-Tab", command = "Editor: Outdent", onlyContexts = {"FencedCode"} },
  { icon = "md-link", description = "Link to page", command = "Text: Wiki Link", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "paperclip", description = "Upload file", command = "File: Upload", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "md-format-bold", description = "Bold", command = "Text: Bold", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "md-format-italic", description = "Italic", command = "Text: Italic", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "hash", description = "Tag", exceptContexts = {"FencedCode", "FrontMatter"}, run = function()
    insertCompletionTrigger("#")
  end },
  { icon = [[<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="16" y1="4" x2="8" y2="20"/></svg>]], description = "Slash command", exceptContexts = {"FencedCode", "FrontMatter"}, run = function()
    insertCompletionTrigger("/")
  end },
  { icon = "rotate-ccw", description = "Undo", command = "Editor: Undo" },
  { icon = "rotate-cw", description = "Redo", command = "Editor: Redo" },
  { icon = "terminal", description = "Run command", command = "Open Command Palette" },
})

-- The formatting bubble over selected text on desktop, in this order
config.set("markupBar.selection", {
  { icon = "md-format-bold", description = "Bold", command = "Text: Bold", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "md-format-italic", description = "Italic", command = "Text: Italic", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "md-format-strikethrough", description = "Strikethrough", command = "Text: Strikethrough", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "md-code", description = "Code", command = "Text: Code", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "edit-3", description = "Highlight", command = "Text: Marker", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "md-link", description = "Link to page", command = "Text: Wiki Link", exceptContexts = {"FencedCode", "FrontMatter"} },
  { icon = "external-link", description = "Link to URL", command = "Text: Link Selection", exceptContexts = {"FencedCode", "FrontMatter"} },
})

-- The menu of the ⋮ line handle on desktop, in this order (after Add tag and
-- Set state, which it builds itself; a blank line lists the slash menu's
-- blocks, which it also builds itself)
config.set("markupBar.line", {
  -- A list item
  { icon = "md-format-indent-increase", description = "Indent", command = "Outline: Move Right", onlyContexts = {"ListItem"} },
  { icon = "md-format-indent-decrease", description = "Outdent", command = "Outline: Move Left", onlyContexts = {"ListItem"} },
  { icon = "arrow-up", description = "Move up", command = "Outline: Move Up", onlyContexts = {"ListItem"} },
  { icon = "arrow-down", description = "Move down", command = "Outline: Move Down", onlyContexts = {"ListItem"} },
  -- A heading
  { icon = "md-format-size", description = "Heading 1", group = "Heading", command = "Text: Heading 1", onlyContexts = {"ATXHeading"}, activeContexts = {"ATXHeading1"} },
  { icon = "md-format-size", description = "Heading 2", group = "Heading", command = "Text: Heading 2", onlyContexts = {"ATXHeading"}, activeContexts = {"ATXHeading2"} },
  { icon = "md-format-size", description = "Heading 3", group = "Heading", command = "Text: Heading 3", onlyContexts = {"ATXHeading"}, activeContexts = {"ATXHeading3"} },
  { icon = "md-format-size", description = "Heading 4", group = "Heading", command = "Text: Heading 4", onlyContexts = {"ATXHeading"}, activeContexts = {"ATXHeading4"} },
  { icon = "type", description = "Normal text", group = "Heading", command = "Text: Normal Text", onlyContexts = {"ATXHeading"} },
  { icon = "arrow-up", description = "Move section up", command = "Outline: Move Up", onlyContexts = {"ATXHeading"} },
  { icon = "arrow-down", description = "Move section down", command = "Outline: Move Down", onlyContexts = {"ATXHeading"} },
  { icon = "md-format-indent-increase", description = "Demote section", command = "Outline: Move Right", onlyContexts = {"ATXHeading"} },
  { icon = "md-format-indent-decrease", description = "Promote section", command = "Outline: Move Left", onlyContexts = {"ATXHeading"} },
  -- A table row
  { icon = "arrow-up", description = "Move row up", command = "Outline: Move Up", onlyContexts = {"TableRow"} },
  { icon = "arrow-down", description = "Move row down", command = "Outline: Move Down", onlyContexts = {"TableRow"} },
  -- A paragraph
  { icon = "md-format-size", description = "Heading 1", group = "Turn into heading", command = "Text: Heading 1", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem"} },
  { icon = "md-format-size", description = "Heading 2", group = "Turn into heading", command = "Text: Heading 2", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem"} },
  { icon = "md-format-size", description = "Heading 3", group = "Turn into heading", command = "Text: Heading 3", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem"} },
  { icon = "md-format-size", description = "Heading 4", group = "Turn into heading", command = "Text: Heading 4", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem"} },
  { icon = "md-format-list-bulleted", description = "Turn into bullet item", command = "Text: Listify Selection", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem", "Blockquote"} },
  { icon = "md-format-list-numbered", description = "Turn into numbered item", command = "Text: Number Listify Selection", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem", "Blockquote"} },
  { icon = "md-checklist", description = "Turn into task", command = "Text: Taskify Line", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem", "Blockquote"} },
  { icon = "md-format-quote", description = "Turn into quote", command = "Text: Quote Selection", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem", "Blockquote"} },
  { icon = "paperclip", description = "Upload file", command = "File: Upload", onlyContexts = {"Paragraph"}, exceptContexts = {"ListItem", "FencedCode", "FrontMatter"} },
  -- A list item that is no task yet
  { icon = "md-checklist", description = "Turn into task", command = "Text: Taskify Line", onlyContexts = {"ListItem"}, exceptContexts = {"Task"} },
  -- A heading or a list item with nested items: Collapse when open, Expand when folded
  { icon = "md-unfold-less", description = "Collapse", command = "Outline: Toggle Fold", onlyContexts = {"ATXHeading", "@hasChildren"}, exceptContexts = {"@folded"} },
  { icon = "md-unfold-more", description = "Expand", command = "Outline: Toggle Fold", onlyContexts = {"@folded"} },
  -- A table, with its source showing
  { icon = "grid", description = "Format table", command = "Table: Format", onlyContexts = {"Table"} },
})
```
