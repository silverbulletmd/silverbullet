---
tags: meta
---
Widgets, styles and navigation for the docs.silverbullet.md site and Desktop's built-in Help.

```space-lua
view.define {
  name = "website.maturity",
  dock = "page-top",
  frame = "minimal",
  content = function()
    local meta = editor.getCurrentPageMeta()
    if not meta then
      return
    end
    for _, tagName in ipairs(meta.tags) do
      if tagName:startsWith("maturity/") then
        return widget.new {
          markdown = spacelua.interpolate([==[
**Note:** This is a #${maturityTag} feature. Feel free to use it, but it may change (significantly) in the future or potentially be replaced.
]==], {maturityTag=tagName}),
          cssClasses = {"website-warning"},
        }
      end
    end
  end,
}
```

```space-style
.website-warning {
  background-color: #fff1d8;
  padding: 10px;
  margin: 0;
}

html[data-theme="dark"] .website-warning {
  background-color: #403521;
}
```

# Navigation
The left-hand **Navigate** view: a hand-curated tree of this site.

```space-lua
docsNav = docsNav or {}

-- The tree in display order. Each section and each node is a table with:
--   ref: page to open (omit for a plain folder, then give a label)
--   label: tree label, defaulting to the last segment of ref
--   icon: Feather icon name
--   childrenFrom: page prefix whose pages the Navigate view lists as children and its child nodes as array items.
docsNav.sections = {
  { name = "Start", ref = "SilverBullet", icon = "home",
    description = "What SilverBullet is, choosing a setup, and first steps.",
    { ref = "Getting Started", icon = "play-circle" },
    { ref = "Videos", icon = "video" },
    { ref = "Guide", icon = "compass" },
    { ref = "Guide/Best Practices", icon = "check-circle" },
    { ref = "Knowledge Management System", icon = "book" },
  },
  { name = "Desktop", ref = "Desktop", icon = "monitor",
    description = "The native app for macOS, Windows and Linux: local spaces, sync, Meta Space and licensing.",
    { ref = "Install/Desktop", label = "Install", icon = "download" },
    { ref = "Local Space", icon = "folder" },
    { ref = "Desktop Sync", icon = "refresh-cw" },
    { ref = "Meta Space", icon = "layers" },
    { ref = "Licensing", icon = "award" },
    { ref = "Desktop Updates", icon = "download-cloud" },
  },
  { name = "Server", ref = "Install", icon = "server",
    description = "Install, configure, secure and publish a self-hosted SilverBullet Server.",
    { ref = "Install/Docker", icon = "package" },
    { ref = "Install/Server Binary", icon = "hard-drive" },
    { ref = "Install/Configuration", icon = "settings" },
    { ref = "Install/Server Modes", icon = "toggle-right" },
    { ref = "Install/Network and Internet", icon = "globe" },
    { label = "Deployments",
      { ref = "TLS", icon = "shield" },
      { ref = "Deployments/Caddy", icon = "box" },
    },
    { ref = "Dashboard", icon = "grid" },
    { ref = "Account", icon = "users" },
    { ref = "Authentication", icon = "key",
      { ref = "Single Sign-On", icon = "log-in" },
      { ref = "Authentication Proxy", icon = "shuffle" },
      { ref = "Authelia", icon = "user-check" },
    },
    { ref = "Security", icon = "shield",
      { ref = "Security Profiles", icon = "sliders" },
    },
    { ref = "Client Encryption", icon = "lock" },
    { ref = "Zero Tracking", icon = "eye-off" },
    { ref = "PWA", icon = "smartphone" },
    { ref = "Publishing", icon = "globe" },
    { ref = "Runtime API", icon = "cpu" },
    { ref = "HTTP API", icon = "code" },
    { ref = "Troubleshooting", icon = "life-buoy",
      { ref = "Log", icon = "file-text" },
    },
    { ref = "Migrate from v1", icon = "corner-up-right" },
  },
  { name = "Writing", ref = "Writing", icon = "edit-3",
    description = "The editor, pages, tasks, templates and the pickers you use every day.",
    { ref = "Editor", icon = "edit" },
    { ref = "Live Preview", icon = "eye" },
    { ref = "Top Bar", icon = "minus" },
    { ref = "Page Namer", icon = "type" },
    { ref = "Index Page", icon = "home" },
    { ref = "Space", icon = "folder" },
    { ref = "Page", icon = "file-text" },
    { ref = "Document", icon = "file" },
    { ref = "Document Editor", icon = "file" },
    { ref = "Outlines", icon = "list" },
    { ref = "Task", icon = "check-square" },
    { ref = "Journal", icon = "calendar" },
    { ref = "Page Template", icon = "layout" },
    { ref = "Slash Command", icon = "terminal" },
    { ref = "Slash Templates", icon = "zap" },
    { ref = "Completion", icon = "chevrons-right" },
    { ref = "Page Picker", icon = "search" },
    { ref = "Meta Picker", icon = "search" },
    { ref = "Anything Picker", icon = "search" },
    { ref = "Command Palette", icon = "terminal" },
    { ref = "Vim", icon = "edit-3" },
    { ref = "Export", icon = "share" },
    { ref = "Guide/Knowledge Base", icon = "book" },
    { ref = "Guide/Task Management", icon = "check-square" },
  },
  { name = "Linking & Exploring", ref = "Linking and Exploring", icon = "link",
    description = "Links, backlinks, tags, transclusions and the Object Graph.",
    { ref = "Link", icon = "link" },
    { ref = "Aspiring Pages", icon = "file-plus" },
    { ref = "Linked Mention", icon = "corner-down-left" },
    { ref = "Linked Tasks", icon = "check-square" },
    { ref = "Tag", icon = "hash" },
    { ref = "Tag Picker", icon = "hash" },
    { ref = "Transclusions", icon = "copy" },
    { ref = "Folder", icon = "folder" },
    { ref = "File Tree", icon = "folder" },
    { ref = "Full Text Search", icon = "search" },
    { ref = "Object Graph", icon = "share-2" },
    { ref = "X-Ray", icon = "aperture" },
  },
  { name = "Queries & Data", ref = "Queries and Data", icon = "database",
    description = "Objects, attributes and frontmatter, and how to query them.",
    { ref = "Object", icon = "box" },
    { ref = "Object Index", icon = "database" },
    { ref = "Metadata", icon = "info" },
    { ref = "Frontmatter", icon = "sidebar" },
    { ref = "Attribute", icon = "sliders" },
    { ref = "Schema", icon = "check" },
    { ref = "Space Lua/Integrated Query", icon = "filter",
      { ref = "Space Lua/Integrated Query/Grouping", icon = "layers" },
      { ref = "Space Lua/Integrated Query/Aggregating", icon = "bar-chart-2" },
    },
    { ref = "Template", icon = "file-text" },
    { ref = "Guide/Aggregator Pages", icon = "layers" },
    { ref = "Baked Sections", icon = "save" },
  },
  { name = "Customizing", ref = "Customizing", icon = "code",
    description = "Space Lua, Space Style, commands, views and libraries.",
    { ref = "Space Lua", icon = "moon" },
    { ref = "Space Lua/Conventions", icon = "check-circle" },
    { ref = "Space Lua/Quirks", icon = "alert-triangle" },
    { ref = "Space Lua/Thread Locals", icon = "box" },
    { ref = "Space Lua/JavaScript Interop", icon = "repeat" },
    { ref = "Widget", icon = "square" },
    { ref = "Space Lua/DOM", icon = "code" },
    { ref = "View", icon = "sidebar" },
    { ref = "Command", icon = "terminal" },
    { ref = "Event", icon = "radio" },
    { ref = "Service", icon = "share-2" },
    { ref = "Space Style", icon = "droplet" },
    { ref = "Page Decorations", icon = "star" },
    { ref = "Virtual Pages", icon = "file" },
    { ref = "Keyboard Shortcuts", icon = "command" },
    { ref = "Meta Page", icon = "settings" },
    { ref = "Configuration Manager", icon = "sliders" },
    { ref = "Extensions", icon = "package" },
    { ref = "Library", icon = "package",
      { ref = "Repository", icon = "archive" },
      { ref = "Library/Development", icon = "tool" },
    },
    { ref = "Plugs", icon = "zap",
      { ref = "Plugs/Development", icon = "tool",
        { ref = "Plugs/Development/Architecture", icon = "layers" },
        { ref = "Plugs/Development/Distribution and Testing", icon = "send" },
        { ref = "Plugs/Development/Reference", icon = "book" },
      },
    },
  },
  { name = "Working Together", ref = "Guide/Working Together", icon = "users",
    description = "Sharing a space: mentions, comments, authorship, revisions and sync.",
    { ref = "Collaboration", icon = "users" },
    { ref = "Identity", icon = "user" },
    { ref = "At-Mention", icon = "at-sign" },
    { ref = "Recipient", icon = "inbox" },
    { ref = "Authorship", icon = "edit-3" },
    { ref = "Markdown/Comment", icon = "message-square" },
    { ref = "Revisions", icon = "git-commit" },
    { ref = "Git", icon = "git-branch" },
    { ref = "Sync", icon = "refresh-cw" },
    { ref = "Share", icon = "share-2" },
  },
  { name = "Reference", ref = "Reference", icon = "bookmark",
    description = "Markdown syntax, the Space Lua API, configuration options and the CLI.",
    { ref = "Glossary", icon = "list" },
    { ref = "Markdown", icon = "file-text",
      { ref = "Markdown/Basics", icon = "type" },
      { ref = "Markdown/Extensions", icon = "plus-square" },
      { ref = "Markdown/Hashtags", icon = "hash" },
      { ref = "Markdown/Admonition", icon = "alert-circle" },
      { ref = "Markdown/Anchor", icon = "anchor" },
      { ref = "Markdown/Footnotes", icon = "corner-down-left" },
      { ref = "Markdown/Fenced Code Block", icon = "code" },
      { ref = "Markdown/Syntax Highlighting", icon = "droplet" },
      { ref = "Markdown/HTML", icon = "code" },
    },
    { ref = "API", label = "Space Lua API", icon = "cpu", childrenFrom = "API/" },
    { ref = "Space Lua/Standard Library", icon = "book" },
    { ref = "Library/Std/Config", label = "Configuration Options", icon = "settings" },
    { ref = "CLI", icon = "terminal" },
    { ref = "Names", icon = "tag" },
    { ref = "Paths", icon = "folder" },
    { ref = "URI", icon = "link-2" },
    { ref = "YAML", icon = "file-text" },
  },
  { name = "Contributing", ref = "Development", icon = "git-pull-request",
    description = "Developing SilverBullet: architecture, decisions and the changelog.",
    { ref = "Architecture", icon = "layers" },
    { ref = "ADR", icon = "clipboard" },
    { ref = "CHANGELOG", icon = "clock" },
  },
}

-- Flattened to { name = "Section/.../Label", ref, icon, childrenFrom } entries,
-- parents before children, for the Navigate view and the section pages.
local function flatten(node, path, out)
  for _, child in ipairs(node) do
    local name = path .. "/" .. (child.label or child.ref:match("[^/]+$"))
    if child.ref then
      out[#out + 1] = {
        name = name,
        ref = child.ref,
        icon = child.icon,
        childrenFrom = child.childrenFrom,
      }
    end
    flatten(child, name, out)
  end
end

docsNav.pages = {}
for _, section in ipairs(docsNav.sections) do
  docsNav.pages[#docsNav.pages + 1] = {
    name = section.name,
    ref = section.ref,
    icon = section.icon,
  }
  flatten(section, section.name, docsNav.pages)
end

function docsNav.entryByName(name)
  for _, entry in ipairs(docsNav.pages) do
    if entry.name == name then
      return entry
    end
  end
end

function docsNav.summary(ref)
  local ok, text = pcall(space.readPage, ref)
  if not ok or not text then
    return nil
  end
  local extracted = index.extractFrontmatter(text, {
    removeFrontMatterSection = true,
    removeTags = true,
  })
  local frontmatter = extracted.frontmatter or {}
  if frontmatter.description then
    return frontmatter.description
  end
  local fence = string.rep("`", 3)
  for _, line in ipairs(string.split(extracted.text, "\n")) do
    local trimmed = string.trim(line)
    if trimmed ~= ""
      and not trimmed:startsWith("#")
      and not trimmed:startsWith("${")
      and not trimmed:startsWith(fence)
      and not trimmed:startsWith(">") then
      return trimmed
    end
  end
end

function docsNav.problems()
  local existing = {}
  for _, page in ipairs(query[[from index.pages()]]) do
    existing[page.name] = true
  end
  local issues = {}
  local seenRefs = {}
  local seenNames = {}
  for _, entry in ipairs(docsNav.pages) do
    if not existing[entry.ref] then
      table.insert(issues, "* Missing page `" .. entry.ref .. "` (at `" .. entry.name .. "`)")
    end
    if seenRefs[entry.ref] then
      table.insert(issues, "* Page listed twice: `" .. entry.ref .. "`")
    end
    if seenNames[entry.name] then
      table.insert(issues, "* Tree path used twice: `" .. entry.name .. "`")
    end
    seenRefs[entry.ref] = true
    seenNames[entry.name] = true
  end
  if #issues == 0 then
    return "No navigation problems found."
  end
  return table.concat(issues, "\n")
end
```

```space-lua
view.define {
  name = "docs.navigate",
  title = "Navigate",
  command = "Navigate: Documentation",
  dock = "lhs",
  supportedDocks = { "lhs", "rhs", "modal" },
  followEditor = true,
  placeholder = "Filter pages...",
  refreshOn = { "index" },
  source = function()
    local pages = {}
    for _, page in ipairs(query[[from index.pages()]]) do
      pages[page.name] = page
    end
    -- The curated entries, plus every page under an entry's childrenFrom prefix.
    local entries = {}
    for _, entry in ipairs(docsNav.pages) do
      entries[#entries + 1] = entry
      local prefix = entry.childrenFrom
      if prefix then
        local children = {}
        for name in pairs(pages) do
          if name:startsWith(prefix) then
            children[#children + 1] = name
          end
        end
        table.sort(children)
        for _, name in ipairs(children) do
          entries[#entries + 1] = {
            name = entry.name .. "/" .. name:sub(#prefix + 1),
            ref = name,
          }
        end
      end
    end
    -- Entries with children below them, so onSelect can unfold them.
    local parents = {}
    for _, entry in ipairs(entries) do
      local slash = entry.name:find("/[^/]*$")
      if slash then
        parents[entry.name:sub(1, slash - 1)] = true
      end
    end
    local rows = {}
    for _, entry in ipairs(entries) do
      local page = pages[entry.ref]
      if page then
        rows[#rows + 1] = {
          name = entry.name,
          ref = entry.ref,
          icon = entry.icon,
          pageDecoration = page.pageDecoration,
          perm = page.perm,
          hasChildren = parents[entry.name] or false,
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
    if o.ref then
      editor.navigate(o.ref)
    end
    -- Opening a section page also unfolds its node in the tree.
    if o.hasChildren then
      return "navigator:expand"
    end
  end,
}
```
