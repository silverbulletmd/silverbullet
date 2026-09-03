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
  "Install/Configuration",
  "Manual",

  "Guides/Getting Started",
  "Guides/Best Practices",
  "Guides/Knowledge Base",
  "Guides/Task Management",
  "Guides/Working Together",
  "Guides/Aggregator Pages",

  "Features",
  "Features/Editor",
  "Features/Live Preview",
  "Features/Completion",
  "Features/Page Picker",
  "Features/Navigator",
  "Features/Command Palette",
  "Features/Full Text Search",
  "Features/Meta Picker",
  "Features/Tag Picker",
  "Features/Anything Picker",
  "Features/Page Namer",
  "Features/File Tree",
  "Features/Journal",
  "Features/Document Editor",
  "Features/Slash Template",
  "Features/Revisions",
  "Features/Collaboration",
  "Features/Share",
  "Features/Sync",
  "Features/PWA",
  "Features/Object Graph",
  "Features/X-Ray",
  "Features/Virtual Pages",
  "Features/Vim Mode",
  "Features/Configuration Manager",
  "Features/Space Manager",
  "Features/Extensions",
  "Features/Authentication",
  "Features/Client Encryption",
  "Features/CLI",
  "Features/Runtime API",

  "Concepts",
  "Concepts/Space",
  "Concepts/Page",
  "Concepts/Folder",
  "Concepts/Path",
  "Concepts/Document",
  "Concepts/Meta Page",
  "Concepts/Aspiring Page",
  "Concepts/Link",
  "Concepts/Linked Mention",
  "Concepts/Transclusion",
  "Concepts/Tag",
  "Concepts/Task",
  "Concepts/Linked Task",
  "Concepts/Outline",
  "Concepts/At-Mention",
  "Concepts/Frontmatter",
  "Concepts/Attribute",
  "Concepts/Metadata",
  "Concepts/Object Index",
  "Concepts/Page Template",
  "Concepts/Slash Command",
  "Concepts/Command",
  "Concepts/Page Decoration",
  "Concepts/Space Style",
  "Concepts/Library",
  "Concepts/Repository",
  "Concepts/Authorship",
  "Concepts/Recipient",
  "Concepts/Baked Sections",
  "Concepts/End-User Programming",
  "Concepts/Knowledge Management System",

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
  "Principles/Malleable",
  "Principles/Local First",
  "Principles/Private",
  "Principles/Self Hosted",
  "Principles/Data Sovereignty",
  "Principles/Open Source",
  "Principles/Zero Tracking",

  -- Internals
  "Architecture",
  "Architecture/ADR",
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
    for _, name in ipairs(navPages) do
      -- A renamed or deleted page drops out rather than offering a row that
      -- lands a reader on a page that isn't there.
      if exists[name] then
        rows[#rows + 1] = { name = name }
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
    editor.navigate(o.name)
  end,
}
```
