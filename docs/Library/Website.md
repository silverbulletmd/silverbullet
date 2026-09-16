---
tags: meta
references:
- libraries/Library/Std/Infrastructure/Share.md
---

Some silverbullet.md specific widgets etc.

```space-lua
event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    local meta = editor.getCurrentPageMeta()
    if not meta then
      return
    end
    local maturityTag = nil
    for _, tagName in ipairs(meta.tags) do
      if tagName:startsWith("maturity/") then
        maturityTag = tagName
      end
    end
    if maturityTag then
      return widget.new {
        markdown = spacelua.interpolate([==[
**Note:** This is a #${maturityTag} feature. Feel free to use it, but it may change (significantly) in the future or potentially be replaced.
]==], {maturityTag=maturityTag}),
        cssClasses = {"website-warning"},
        display = "block"
      }
    end
  end
}
```

```space-style
.website-warning {
  background-color: #fff1d8;
  padding: 10px;
  margin: 0px !important;
}

html[data-theme="dark"] .website-warning {
  background-color: #403521;
}
```

# Navigation
The left-hand **Navigate** view: a hand-curated tree of this site.

```space-lua
-- Curated order. A page's position among its siblings is where it appears
-- here; a section's position is where its first entry appears, so an entry
-- must stay with its section.
local navPages = {
  -- Orientation
  "SilverBullet",
  "CHANGELOG",
  "Funding",
  "Install",
  "Install/Docker",
  "Install/Binary",
  "Manual",

  -- Admin
  "Administration",
  { name = "Administration/Dashboard", ref = "Dashboard"},
  { name = "Administration/Authentication", ref = "Authentication"}, 
  { name = "Administration/Accounts", ref = "Account"}, 
  { name = "Administration/Single Sign-On", ref = "Single Sign-On"}, 
  { name = "Administration/Security", ref = "Security"}, 
  { name = "Administration/Client Encryption", ref = "Client Encryption"}, 
  { name = "Administration/Runtime API", ref = "Runtime API"}, 

  -- Guides
  { name = "Guides", ref = "Guide" },
  { name = "Guides/Getting Started", ref = "Getting Started" },
  { name = "Guides/Best Practices", ref = "Guide/Best Practices" },
  { name = "Guides/Knowledge Base", ref = "Guide/Knowledge Base" },
  { name = "Guides/Task Management", ref = "Guide/Task Management" },
  { name = "Guides/Working Together", ref = "Guide/Working Together" },
  { name = "Guides/Aggregator Pages", ref = "Guide/Aggregator Pages" },

  { name = "Features/Editor", ref = "Editor" },
  { name = "Features/Live Preview", ref = "Live Preview" },
  { name = "Features/Completion", ref = "Completion" },
  { name = "Features/Page Picker", ref = "Page Picker" },
  { name = "Features/Views", ref = "View" },
  { name = "Features/Command Palette", ref = "Command Palette" },
  { name = "Features/Full Text Search", ref = "Full Text Search" },
  { name = "Features/Meta Picker", ref = "Meta Picker" },
  { name = "Features/Tag Picker", ref = "Tag Picker" },
  { name = "Features/Anything Picker", ref = "Anything Picker" },
  { name = "Features/Page Namer", ref = "Page Namer" },
  { name = "Features/File Tree", ref = "File Tree" },
  { name = "Features/Journal", ref = "Journal" },
  { name = "Features/Document Editor", ref = "Document Editor" },
  { name = "Features/Slash Templates", ref = "Slash Templates" },
  { name = "Features/Revisions", ref = "Revisions" },
  { name = "Features/Collaboration", ref = "Collaboration" },
  { name = "Features/Share", ref = "Share" },
  { name = "Features/Sync", ref = "Sync" },
  { name = "Features/PWA", ref = "PWA" },
  { name = "Features/Object Graph", ref = "Object Graph" },
  { name = "Features/X-Ray", ref = "X-Ray" },
  { name = "Features/Virtual Pages", ref = "Virtual Pages" },
  { name = "Features/Vim", ref = "Vim" },
  { name = "Features/Configuration Manager", ref = "Configuration Manager" },
  { name = "Features/Extensions", ref = "Extensions" },
  { name = "Features/Client Encryption", ref = "Client Encryption" },
  { name = "Features/CLI", ref = "CLI" },
  { name = "Features/Runtime API", ref = "Runtime API" },

  { name = "Concepts/Space", ref = "Space" },
  { name = "Concepts/Page", ref = "Page" },
  { name = "Concepts/Folder", ref = "Folder" },
  { name = "Concepts/Paths", ref = "Paths" },
  { name = "Concepts/Document", ref = "Document" },
  { name = "Concepts/Meta Page", ref = "Meta Page" },
  { name = "Concepts/Aspiring Pages", ref = "Aspiring Pages" },
  { name = "Concepts/Link", ref = "Link" },
  { name = "Concepts/Linked Mention", ref = "Linked Mention" },
  { name = "Concepts/Transclusions", ref = "Transclusions" },
  { name = "Concepts/Tag", ref = "Tag" },
  { name = "Concepts/Task", ref = "Task" },
  { name = "Concepts/Linked Tasks", ref = "Linked Tasks" },
  { name = "Concepts/Outlines", ref = "Outlines" },
  { name = "Concepts/At-Mention", ref = "At-Mention" },
  { name = "Concepts/Frontmatter", ref = "Frontmatter" },
  { name = "Concepts/Attribute", ref = "Attribute" },
  { name = "Concepts/Metadata", ref = "Metadata" },
  { name = "Concepts/Object Index", ref = "Object Index" },
  { name = "Concepts/Page Template", ref = "Page Template" },
  { name = "Concepts/Slash Command", ref = "Slash Command" },
  { name = "Concepts/Command", ref = "Command" },
  { name = "Concepts/Page Decorations", ref = "Page Decorations" },
  { name = "Concepts/Space Style", ref = "Space Style" },
  { name = "Concepts/Library", ref = "Library" },
  { name = "Concepts/Repository", ref = "Repository" },
  { name = "Concepts/Authorship", ref = "Authorship" },
  { name = "Concepts/Recipient", ref = "Recipient" },
  { name = "Concepts/Baked Sections", ref = "Baked Sections" },
  { name = "Concepts/End-User Programming", ref = "End-User Programming" },
  { name = "Concepts/Knowledge Management System", ref = "Knowledge Management System" },

  "Markdown",
  "Markdown/Basics",
  "Markdown/Extensions",
  "Markdown/Hashtags",
  "Markdown/Admonition",
  "Markdown/Anchor",
  "Markdown/Footnotes",
  "Markdown/Fenced Code Block",
  "Markdown/Syntax Highlighting",
  "Markdown/Comment",
  "Markdown/HTML",

  -- Programming your space
  "Space Lua",
  "Space Lua/Integrated Query",
  "Space Lua/Standard Library",
  "Space Lua/Widget",
  "Space Lua/DOM",
  "Space Lua/Conventions",
  "Space Lua/Thread Locals",
  "Space Lua/JavaScript Interop",
  "Space Lua/Quirks",

  -- API reference
  "API",
  "API/index",
  "API/editor",
  "API/space",
  "API/system",
  "API/command",
  "API/slashCommand",
  "API/event",
  "API/config",
  "API/view",
  "API/widget",
  "API/codeWidget",
  "API/template",
  "API/spacelua",
  "API/syntax",
  "API/tag",
  "API/taskState",
  "API/search",
  "API/markdown",
  "API/dom",
  "API/datastore",
  "API/clientStore",
  "API/asset",
  "API/service",
  "API/sync",
  "API/identity",
  "API/http",
  "API/net",
  "API/mq",
  "API/shell",
  "API/os",
  "API/js",
  "API/jsonschema",
  "API/language",
  "API/encoding",
  "API/icon",
  "API/global",
  "API/lua",
  "API/string",
  "API/table",
  "API/math",
  "API/yaml",

  -- The object index
  "Object",
  "Object/page",
  "Object/task",
  "Object/item",
  "Object/paragraph",
  "Object/header",
  "Object/link",
  "Object/tag",
  "Object/data",
  "Object/anchor",
  "Object/document",
  "Object/table",
  "Object/relation",
  "Object/aspiring-page",
  "Object/ambiguous-link",
  "Object/space-lua",

  -- Principles
  { name = "Principles/Malleable", ref = "Malleable" },
  { name = "Principles/Local First", ref = "Local First" },
  { name = "Principles/Private", ref = "Private" },
  { name = "Principles/Self Hosted", ref = "Self Hosted" },
  { name = "Principles/Data Sovereignty", ref = "Data Sovereignty" },
  { name = "Principles/Open Source", ref = "Open Source" },
  { name = "Principles/Zero Tracking", ref = "Zero Tracking" },

  -- Internals
  "Architecture",
  { name = "Architecture/ADR", ref = "ADR" },
}


view.define {
  name = "docs.navigate",
  title = "Navigate",
  command = "Navigate: Documentation",
  dock = "lhs",
  supportedDocks = { "lhs", "rhs", "modal" },
  followEditor = true,
  placeholder = "Filter pages...",
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  source = function()
    local exists = {}
    for _, name in ipairs(query[[from p = index.pages() select p.name]]) do
      exists[name] = true
    end
    local rows = {}
    for _, entry in ipairs(navPages) do
      local name = type(entry) == "string" and entry or entry.name
      local ref = type(entry) == "string" and entry or entry.ref
      -- A renamed or deleted page drops out rather than offering a row that
      -- lands a reader on a page that isn't there.
      if exists[ref] then
        rows[#rows + 1] = { name = name, ref = ref }
      end
    end
    return rows
  end,
  presentation = {
    mode = "tree",
    -- Sections and loose pages interleave in the curated order; the default
    -- would hoist every section above every page.
    foldersFirst = false,
    limit = 500,
  },
  onSelect = function(o)
    editor.navigate(o.ref or o.name)
  end,
}
```
