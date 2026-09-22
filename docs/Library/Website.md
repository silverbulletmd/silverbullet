---
tags: meta
---
Some silverbullet.md specific widgets and styles.

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
local navPages = {
  -- Orientation
  { name = "SilverBullet", ref = "SilverBullet", icon = "home" },
  { name = "CHANGELOG", ref = "CHANGELOG", icon = "clock" },
  { name = "Funding", ref = "Funding", icon = "heart" },
  { name = "Install", ref = "Install", icon = "download" },
  { name = "Install/Docker", ref = "Install/Docker", icon = "package" },
  { name = "Install/Server Binary", ref = "Install/Server Binary", icon = "server" },
  { name = "Install/Desktop", ref = "Install/Desktop", icon = "monitor" },
  { name = "Install/Configuration", ref = "Install/Configuration", icon = "settings" },
  { name = "Install/Server Modes", ref = "Install/Server Modes"},

  -- Admin
  { name = "Administration", ref = "Administration", icon = "settings" },
  { name = "Administration/Dashboard", ref = "Dashboard", icon = "grid" },
  { name = "Administration/Authentication", ref = "Authentication", icon = "key" },
  { name = "Administration/Accounts", ref = "Account", icon = "users" },
  { name = "Administration/Single Sign-On", ref = "Single Sign-On", icon = "log-in" },
  { name = "Administration/Security", ref = "Security", icon = "shield" },
  { name = "Administration/Client Encryption", ref = "Client Encryption", icon = "lock" },
  { name = "Administration/Runtime API", ref = "Runtime API", icon = "cpu" },

  { name = "Manual", ref = "Manual", icon = "book-open" },
  { name = "Manual/Page Picker", ref = "Page Picker", icon = "search" },
  { name = "Manual/Command Palette", ref = "Command Palette", icon = "terminal" },
  { name = "Manual/File Tree", ref = "File Tree", icon = "folder" },
  { name = "Manual/Live Preview", ref = "Live Preview", icon = "eye" },
  { name = "Manual/Revisions", ref = "Revisions", icon = "git-commit" },
  { name = "Manual/Collaboration", ref = "Collaboration", icon = "users" },
  { name = "Manual/Share", ref = "Share", icon = "share-2" },
  { name = "Manual/Sync", ref = "Sync", icon = "refresh-cw" },
  { name = "Manual/Object Graph", ref = "Object Graph", icon = "share-2" },
  { name = "Manual/Vim", ref = "Vim", icon = "edit-3" },
  { name = "Manual/Configuration Manager", ref = "Configuration Manager", icon = "sliders" },
  { name = "Manual/Extensions", ref = "Extensions", icon = "package" },
  { name = "Manual/Client Encryption", ref = "Client Encryption", icon = "lock" },
  { name = "Manual/CLI", ref = "CLI", icon = "terminal" },

  -- Guides
  { name = "Guides", ref = "Guide", icon = "compass" },
  { name = "Guides/Videos", ref = "Videos", icon = "video" },
  { name = "Guides/Getting Started", ref = "Getting Started", icon = "play-circle" },
  { name = "Guides/Best Practices", ref = "Guide/Best Practices", icon = "check-circle" },
  { name = "Guides/Knowledge Base", ref = "Guide/Knowledge Base", icon = "book" },
  { name = "Guides/Task Management", ref = "Guide/Task Management", icon = "check-square" },
  { name = "Guides/Working Together", ref = "Guide/Working Together", icon = "users" },
  { name = "Guides/Aggregator Pages", ref = "Guide/Aggregator Pages", icon = "layers" },

  -- Concepts
  { name = "Concepts/Space", ref = "Space", icon = "folder" },
  { name = "Concepts/Page", ref = "Page", icon = "file-text" },
  { name = "Concepts/Meta Page", ref = "Meta Page", icon = "settings" },
  { name = "Concepts/Aspiring Pages", ref = "Aspiring Pages", icon = "file-plus" },
  { name = "Concepts/Document", ref = "Document", icon = "file" },
  { name = "Concepts/Metadata", ref = "Metadata", icon = "info" },
  { name = "Concepts/Frontmatter", ref = "Frontmatter", icon = "sidebar" },
  { name = "Concepts/Attribute", ref = "Attribute", icon = "sliders" },
  { name = "Concepts/Tag", ref = "Tag", icon = "hash" },
  { name = "Concepts/Outlines", ref = "Outlines", icon = "list" },
  { name = "Concepts/Task", ref = "Task", icon = "check-square" },
  { name = "Concepts/Link", ref = "Link", icon = "link" },
  { name = "Concepts/Linked Mention", ref = "Linked Mention", icon = "corner-down-left" },
  { name = "Concepts/Linked Tasks", ref = "Linked Tasks", icon = "check-square" },
  { name = "Concepts/Command", ref = "Command", icon = "terminal" },
  { name = "Concepts/Transclusions", ref = "Transclusions", icon = "copy" },
  { name = "Concepts/Object Index", ref = "Object Index", icon = "database" },
  { name = "Concepts/Page Template", ref = "Page Template", icon = "layout" },
  { name = "Concepts/Slash Command", ref = "Slash Command", icon = "terminal" },
  { name = "Concepts/Page Decorations", ref = "Page Decorations", icon = "star" },
  { name = "Concepts/Space Style", ref = "Space Style", icon = "droplet" },
  { name = "Concepts/Library", ref = "Library", icon = "package" },
  { name = "Concepts/Repository", ref = "Repository", icon = "archive" },
  { name = "Concepts/Baked Sections", ref = "Baked Sections", icon = "save" },

  -- Collaboration
  { name = "Collaboration", ref = "Collaboration", icon = "users" },
  { name = "Collaboration/At-Mention", ref = "At-Mention", icon = "at-sign" },
  { name = "Collaboration/Authorship", ref = "Authorship", icon = "edit-3" },
  { name = "Collaboration/Recipient", ref = "Recipient", icon = "inbox" },
  { name = "Collaboration/Comment", ref = "Markdown/Comment", icon = "message-square" },

  -- Markdown reference
  { name = "Markdown", ref = "Markdown", icon = "file-text" },
  { name = "Markdown/Basics", ref = "Markdown/Basics", icon = "type" },
  { name = "Markdown/Extensions", ref = "Markdown/Extensions", icon = "plus-square" },
  { name = "Markdown/Hashtags", ref = "Markdown/Hashtags", icon = "hash" },
  { name = "Markdown/Admonition", ref = "Markdown/Admonition", icon = "alert-circle" },
  { name = "Markdown/Anchor", ref = "Markdown/Anchor", icon = "anchor" },
  { name = "Markdown/Footnotes", ref = "Markdown/Footnotes", icon = "corner-down-left" },
  { name = "Markdown/Fenced Code Block", ref = "Markdown/Fenced Code Block", icon = "code" },
  { name = "Markdown/Syntax Highlighting", ref = "Markdown/Syntax Highlighting", icon = "droplet" },
  { name = "Markdown/Comment", ref = "Markdown/Comment", icon = "message-square" },
  { name = "Markdown/HTML", ref = "Markdown/HTML", icon = "code" },

  -- Programming your space
  { name = "Space Lua", ref = "Space Lua", icon = "code" },
  { name = "Space Lua/Integrated Query", ref = "Space Lua/Integrated Query", icon = "filter" },
  { name = "Space Lua/Object", ref = "Object", icon = "box" },

  { name = "Space Lua/Standard Library", ref = "Space Lua/Standard Library", icon = "book" },
  { name = "Space Lua/API", ref = "API", icon = "cpu" },
  { name = "Space Lua/Conventions", ref = "Space Lua/Conventions", icon = "check-circle" },
  { name = "Space Lua/Thread Locals", ref = "Space Lua/Thread Locals", icon = "box" },
  { name = "Space Lua/JavaScript Interop", ref = "Space Lua/JavaScript Interop", icon = "repeat" },

  -- Principles
  { name = "Principles/Malleable", ref = "Malleable", icon = "tool" },
  { name = "Principles/Local First", ref = "Local First", icon = "hard-drive" },
  { name = "Principles/Private", ref = "Private", icon = "lock" },
  { name = "Principles/Self Hosted", ref = "Self Hosted", icon = "server" },
  { name = "Principles/Data Sovereignty", ref = "Data Sovereignty", icon = "key" },
  { name = "Principles/Open Source", ref = "Open Source", icon = "code" },
  { name = "Principles/Zero Tracking", ref = "Zero Tracking", icon = "eye-off" },

  -- Internals
  { name = "Architecture", ref = "Architecture", icon = "layers" },
  { name = "Architecture/ADR", ref = "ADR", icon = "clipboard" },
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
    local pages = {}
    for _, page in ipairs(query[[from index.pages()]]) do
      pages[page.name] = page
    end
    local rows = {}
    for _, entry in ipairs(navPages) do
      local name = type(entry) == "string" and entry or entry.name
      local ref = type(entry) == "string" and entry or entry.ref
      local page = pages[ref]
      if page then
        rows[#rows + 1] = {
          name = name,
          ref = ref,
          icon = type(entry) == "table" and entry.icon or nil,
          pageDecoration = page.pageDecoration,
          perm = page.perm,
        }
      end
    end
    return rows
  end,
  presentation = {
    mode = "tree",
    foldersFirst = false,
    limit = 500,
    row = {
      icon = function(o)
        if o.isFolder and not o.ref then
          return "folder"
        end
        if type(o.icon) == "string" and o.icon ~= "" then
          return o.icon
        end
        local decorated = o.pageDecoration and o.pageDecoration.icon
        if type(decorated) == "string" and decorated ~= "" then
          return decorated
        end
        return o.perm == "ro" and "lock" or "file-text"
      end,
    },
  },
  onSelect = function(o)
    editor.navigate(o.ref or o.name)
  end,
}
```
