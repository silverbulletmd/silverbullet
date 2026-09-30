---
tags: meta
---
Widgets, styles and navigation for the docs.silverbullet.md site and Desktop's built-in Help.

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
docsNav = docsNav or {}

docsNav.sections = {
  { name = "Start", description = "What SilverBullet is, choosing a setup, and first steps." },
  { name = "Desktop", description = "The native app for macOS, Windows and Linux: local spaces, sync, Meta Space and licensing." },
  { name = "Server", description = "Install, configure, secure and publish a self-hosted SilverBullet Server." },
  { name = "Writing", description = "The editor, pages, tasks, templates and the pickers you use every day." },
  { name = "Linking & Exploring", description = "Links, backlinks, tags, transclusions and the Object Graph." },
  { name = "Queries & Data", description = "Objects, attributes and frontmatter, and how to query them." },
  { name = "Customizing", description = "Space Lua, Space Style, commands, views and libraries." },
  { name = "Working Together", description = "Sharing a space: mentions, comments, authorship, revisions and sync." },
  { name = "Reference", description = "Markdown syntax, the Space Lua API, configuration options and the CLI." },
  { name = "Contributing", description = "Developing SilverBullet: architecture, decisions and the changelog." },
}

docsNav.pages = {
  -- Start
  { name = "Start", ref = "SilverBullet", icon = "home" },
  { name = "Start/Getting Started", ref = "Getting Started", icon = "play-circle" },
  { name = "Start/Videos", ref = "Videos", icon = "video" },
  { name = "Start/Guides", ref = "Guide", icon = "compass" },
  { name = "Start/Best Practices", ref = "Guide/Best Practices", icon = "check-circle" },
  { name = "Start/Knowledge Management System", ref = "Knowledge Management System", icon = "book" },

  -- Desktop
  { name = "Desktop", ref = "Desktop", icon = "monitor" },
  { name = "Desktop/Install", ref = "Install/Desktop", icon = "download" },
  { name = "Desktop/Local Space", ref = "Local Space", icon = "folder" },
  { name = "Desktop/Sync", ref = "Desktop Sync", icon = "refresh-cw" },
  { name = "Desktop/Meta Space", ref = "Meta Space", icon = "layers" },
  { name = "Desktop/Licensing", ref = "Licensing", icon = "award" },
  { name = "Desktop/Updates", ref = "Desktop Updates", icon = "download-cloud" },

  -- Server
  { name = "Server", ref = "Install", icon = "server" },
  { name = "Server/Docker", ref = "Install/Docker", icon = "package" },
  { name = "Server/Server Binary", ref = "Install/Server Binary", icon = "hard-drive" },
  { name = "Server/Configuration", ref = "Install/Configuration", icon = "settings" },
  { name = "Server/Server Modes", ref = "Install/Server Modes", icon = "toggle-right" },
  { name = "Server/Network and Internet", ref = "Install/Network and Internet", icon = "globe" },
  { name = "Server/Deployments/TLS", ref = "TLS", icon = "shield" },
  { name = "Server/Deployments/Caddy", ref = "Deployments/Caddy", icon = "box" },
  { name = "Server/Dashboard", ref = "Dashboard", icon = "grid" },
  { name = "Server/Accounts", ref = "Account", icon = "users" },
  { name = "Server/Authentication", ref = "Authentication", icon = "key" },
  { name = "Server/Authentication/Single Sign-On", ref = "Single Sign-On", icon = "log-in" },
  { name = "Server/Authentication/Authentication Proxy", ref = "Authentication Proxy", icon = "shuffle" },
  { name = "Server/Authentication/Authelia", ref = "Authelia", icon = "user-check" },
  { name = "Server/Security", ref = "Security", icon = "shield" },
  { name = "Server/Security/Security Profiles", ref = "Security Profiles", icon = "sliders" },
  { name = "Server/Client Encryption", ref = "Client Encryption", icon = "lock" },
  { name = "Server/Zero Tracking", ref = "Zero Tracking", icon = "eye-off" },
  { name = "Server/PWA", ref = "PWA", icon = "smartphone" },
  { name = "Server/Publishing", ref = "Publishing", icon = "globe" },
  { name = "Server/Runtime API", ref = "Runtime API", icon = "cpu" },
  { name = "Server/HTTP API", ref = "HTTP API", icon = "code" },
  { name = "Server/Troubleshooting", ref = "Troubleshooting", icon = "life-buoy" },
  { name = "Server/Troubleshooting/Log", ref = "Log", icon = "file-text" },
  { name = "Server/Migrate from v1", ref = "Migrate from v1", icon = "corner-up-right" },

  -- Writing
  { name = "Writing", ref = "Writing", icon = "edit-3" },
  { name = "Writing/Editor", ref = "Editor", icon = "edit" },
  { name = "Writing/Live Preview", ref = "Live Preview", icon = "eye" },
  { name = "Writing/Top Bar", ref = "Top Bar", icon = "minus" },
  { name = "Writing/Page Namer", ref = "Page Namer", icon = "type" },
  { name = "Writing/Index Page", ref = "Index Page", icon = "home" },
  { name = "Writing/Space", ref = "Space", icon = "folder" },
  { name = "Writing/Page", ref = "Page", icon = "file-text" },
  { name = "Writing/Document", ref = "Document", icon = "file" },
  { name = "Writing/Document Editor", ref = "Document Editor", icon = "file" },
  { name = "Writing/Outlines", ref = "Outlines", icon = "list" },
  { name = "Writing/Task", ref = "Task", icon = "check-square" },
  { name = "Writing/Journal", ref = "Journal", icon = "calendar" },
  { name = "Writing/Page Template", ref = "Page Template", icon = "layout" },
  { name = "Writing/Slash Command", ref = "Slash Command", icon = "terminal" },
  { name = "Writing/Slash Templates", ref = "Slash Templates", icon = "zap" },
  { name = "Writing/Completion", ref = "Completion", icon = "chevrons-right" },
  { name = "Writing/Page Picker", ref = "Page Picker", icon = "search" },
  { name = "Writing/Meta Picker", ref = "Meta Picker", icon = "search" },
  { name = "Writing/Anything Picker", ref = "Anything Picker", icon = "search" },
  { name = "Writing/Command Palette", ref = "Command Palette", icon = "terminal" },
  { name = "Writing/Vim", ref = "Vim", icon = "edit-3" },
  { name = "Writing/Export", ref = "Export", icon = "share" },
  { name = "Writing/Knowledge Base", ref = "Guide/Knowledge Base", icon = "book" },
  { name = "Writing/Task Management", ref = "Guide/Task Management", icon = "check-square" },

  -- Linking & Exploring
  { name = "Linking & Exploring", ref = "Linking and Exploring", icon = "link" },
  { name = "Linking & Exploring/Link", ref = "Link", icon = "link" },
  { name = "Linking & Exploring/Aspiring Pages", ref = "Aspiring Pages", icon = "file-plus" },
  { name = "Linking & Exploring/Linked Mention", ref = "Linked Mention", icon = "corner-down-left" },
  { name = "Linking & Exploring/Linked Tasks", ref = "Linked Tasks", icon = "check-square" },
  { name = "Linking & Exploring/Tag", ref = "Tag", icon = "hash" },
  { name = "Linking & Exploring/Tag Picker", ref = "Tag Picker", icon = "hash" },
  { name = "Linking & Exploring/Transclusions", ref = "Transclusions", icon = "copy" },
  { name = "Linking & Exploring/Folder", ref = "Folder", icon = "folder" },
  { name = "Linking & Exploring/File Tree", ref = "File Tree", icon = "folder" },
  { name = "Linking & Exploring/Full Text Search", ref = "Full Text Search", icon = "search" },
  { name = "Linking & Exploring/Object Graph", ref = "Object Graph", icon = "share-2" },
  { name = "Linking & Exploring/X-Ray", ref = "X-Ray", icon = "aperture" },

  -- Queries & Data
  { name = "Queries & Data", ref = "Queries and Data", icon = "database" },
  { name = "Queries & Data/Object", ref = "Object", icon = "box" },
  { name = "Queries & Data/Object Index", ref = "Object Index", icon = "database" },
  { name = "Queries & Data/Metadata", ref = "Metadata", icon = "info" },
  { name = "Queries & Data/Frontmatter", ref = "Frontmatter", icon = "sidebar" },
  { name = "Queries & Data/Attribute", ref = "Attribute", icon = "sliders" },
  { name = "Queries & Data/Schema", ref = "Schema", icon = "check" },
  { name = "Queries & Data/Integrated Query", ref = "Space Lua/Integrated Query", icon = "filter" },
  { name = "Queries & Data/Integrated Query/Grouping", ref = "Space Lua/Integrated Query/Grouping", icon = "layers" },
  { name = "Queries & Data/Integrated Query/Aggregating", ref = "Space Lua/Integrated Query/Aggregating", icon = "bar-chart-2" },
  { name = "Queries & Data/Template", ref = "Template", icon = "file-text" },
  { name = "Queries & Data/Aggregator Pages", ref = "Guide/Aggregator Pages", icon = "layers" },
  { name = "Queries & Data/Baked Sections", ref = "Baked Sections", icon = "save" },

  -- Customizing
  { name = "Customizing", ref = "Customizing", icon = "code" },
  { name = "Customizing/Space Lua", ref = "Space Lua", icon = "moon" },
  { name = "Customizing/Conventions", ref = "Space Lua/Conventions", icon = "check-circle" },
  { name = "Customizing/Quirks", ref = "Space Lua/Quirks", icon = "alert-triangle" },
  { name = "Customizing/Thread Locals", ref = "Space Lua/Thread Locals", icon = "box" },
  { name = "Customizing/JavaScript Interop", ref = "Space Lua/JavaScript Interop", icon = "repeat" },
  { name = "Customizing/Widget", ref = "Space Lua/Widget", icon = "square" },
  { name = "Customizing/DOM", ref = "Space Lua/DOM", icon = "code" },
  { name = "Customizing/View", ref = "View", icon = "sidebar" },
  { name = "Customizing/Command", ref = "Command", icon = "terminal" },
  { name = "Customizing/Event", ref = "Event", icon = "radio" },
  { name = "Customizing/Service", ref = "Service", icon = "share-2" },
  { name = "Customizing/Space Style", ref = "Space Style", icon = "droplet" },
  { name = "Customizing/Page Decorations", ref = "Page Decorations", icon = "star" },
  { name = "Customizing/Virtual Pages", ref = "Virtual Pages", icon = "file" },
  { name = "Customizing/Keyboard Shortcuts", ref = "Keyboard Shortcuts", icon = "command" },
  { name = "Customizing/Meta Page", ref = "Meta Page", icon = "settings" },
  { name = "Customizing/Configuration Manager", ref = "Configuration Manager", icon = "sliders" },
  { name = "Customizing/Extensions", ref = "Extensions", icon = "package" },
  { name = "Customizing/Library", ref = "Library", icon = "package" },
  { name = "Customizing/Library/Repository", ref = "Repository", icon = "archive" },
  { name = "Customizing/Library/Library Development", ref = "Library/Development", icon = "tool" },
  { name = "Customizing/Plugs", ref = "Plugs", icon = "zap" },
  { name = "Customizing/Plugs/Plug Development", ref = "Plugs/Development", icon = "tool" },
  { name = "Customizing/Plugs/Plug Development/Architecture", ref = "Plugs/Development/Architecture", icon = "layers" },
  { name = "Customizing/Plugs/Plug Development/Distribution and Testing", ref = "Plugs/Development/Distribution and Testing", icon = "send" },
  { name = "Customizing/Plugs/Plug Development/Reference", ref = "Plugs/Development/Reference", icon = "book" },

  -- Working Together
  { name = "Working Together", ref = "Guide/Working Together", icon = "users" },
  { name = "Working Together/Collaboration", ref = "Collaboration", icon = "users" },
  { name = "Working Together/Identity", ref = "Identity", icon = "user" },
  { name = "Working Together/At-Mention", ref = "At-Mention", icon = "at-sign" },
  { name = "Working Together/Recipient", ref = "Recipient", icon = "inbox" },
  { name = "Working Together/Authorship", ref = "Authorship", icon = "edit-3" },
  { name = "Working Together/Comment", ref = "Markdown/Comment", icon = "message-square" },
  { name = "Working Together/Revisions", ref = "Revisions", icon = "git-commit" },
  { name = "Working Together/Git", ref = "Git", icon = "git-branch" },
  { name = "Working Together/Sync", ref = "Sync", icon = "refresh-cw" },
  { name = "Working Together/Share", ref = "Share", icon = "share-2" },

  -- Reference
  { name = "Reference", ref = "Reference", icon = "bookmark" },
  { name = "Reference/Glossary", ref = "Glossary", icon = "list" },
  { name = "Reference/Markdown", ref = "Markdown", icon = "file-text" },
  { name = "Reference/Markdown/Basics", ref = "Markdown/Basics", icon = "type" },
  { name = "Reference/Markdown/Extensions", ref = "Markdown/Extensions", icon = "plus-square" },
  { name = "Reference/Markdown/Hashtags", ref = "Markdown/Hashtags", icon = "hash" },
  { name = "Reference/Markdown/Admonition", ref = "Markdown/Admonition", icon = "alert-circle" },
  { name = "Reference/Markdown/Anchor", ref = "Markdown/Anchor", icon = "anchor" },
  { name = "Reference/Markdown/Footnotes", ref = "Markdown/Footnotes", icon = "corner-down-left" },
  { name = "Reference/Markdown/Fenced Code Block", ref = "Markdown/Fenced Code Block", icon = "code" },
  { name = "Reference/Markdown/Syntax Highlighting", ref = "Markdown/Syntax Highlighting", icon = "droplet" },
  { name = "Reference/Markdown/HTML", ref = "Markdown/HTML", icon = "code" },
  { name = "Reference/Space Lua API", ref = "API", icon = "cpu" },
  { name = "Reference/Standard Library", ref = "Space Lua/Standard Library", icon = "book" },
  { name = "Reference/Configuration Options", ref = "Library/Std/Config", icon = "settings" },
  { name = "Reference/CLI", ref = "CLI", icon = "terminal" },
  { name = "Reference/Names", ref = "Names", icon = "tag" },
  { name = "Reference/Paths", ref = "Paths", icon = "folder" },
  { name = "Reference/URI", ref = "URI", icon = "link-2" },
  { name = "Reference/YAML", ref = "YAML", icon = "file-text" },

  -- Contributing
  { name = "Contributing", ref = "Development", icon = "git-pull-request" },
  { name = "Contributing/Architecture", ref = "Architecture", icon = "layers" },
  { name = "Contributing/ADR", ref = "ADR", icon = "clipboard" },
  { name = "Contributing/CHANGELOG", ref = "CHANGELOG", icon = "clock" },
}

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

function docsNav.sectionList(section)
  local prefix = section .. "/"
  local lines = {}
  local shown = {}
  for _, entry in ipairs(docsNav.pages) do
    if entry.name:startsWith(prefix) then
      local segments = string.split(entry.name:sub(#prefix + 1), "/")
      local path = section
      for depth = 1, #segments - 1 do
        path = path .. "/" .. segments[depth]
        if not shown[path] and not docsNav.entryByName(path) then
          table.insert(lines, string.rep("  ", depth - 1) .. "* **" .. segments[depth] .. "**")
        end
        shown[path] = true
      end
      shown[entry.name] = true
      local item = string.rep("  ", #segments - 1) .. "* [[" .. entry.ref .. "|" .. segments[#segments] .. "]]"
      local summary = docsNav.summary(entry.ref)
      if summary then
        item = item .. ": " .. summary
      end
      table.insert(lines, item)
    end
  end
  return table.concat(lines, "\n")
end

function docsNav.sectionIndex()
  local lines = {}
  for _, section in ipairs(docsNav.sections) do
    local entry = docsNav.entryByName(section.name)
    if entry and section.name ~= "Start" then
      table.insert(lines, "* [[" .. entry.ref .. "|" .. section.name .. "]]: " .. section.description)
    end
  end
  return table.concat(lines, "\n")
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
  for _, section in ipairs(docsNav.sections) do
    if not docsNav.entryByName(section.name) then
      table.insert(issues, "* Section without a landing page: " .. section.name)
    end
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
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  source = function()
    local pages = {}
    for _, page in ipairs(query[[from index.pages()]]) do
      pages[page.name] = page
    end
    -- Entries with children below them, so onSelect can unfold them.
    local parents = {}
    for _, entry in ipairs(docsNav.pages) do
      local slash = entry.name:find("/[^/]*$")
      if slash then
        parents[entry.name:sub(1, slash - 1)] = true
      end
    end
    local rows = {}
    for _, entry in ipairs(docsNav.pages) do
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
