---
tags: meta
---
Widgets, styles and navigation for the docs.silverbullet.md site and Desktop’s built-in Help.

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
  { name = "SilverBullet", ref = "SilverBullet", icon = "home",
    description = "Documentation home.",
  },
  { name = "CHANGELOG", ref = "CHANGELOG", icon = "clock",
    description = "Release history and recent changes.",
  },
  { name = "Getting Started", ref = "Getting Started", icon = "book-open",
    description = "Independent introductions to writing, linking and exploring pages.",
    { ref = "Guide/Reading These Docs" },
    { ref = "Guide/My First Markdown Page" },
    { ref = "Guide/Find and Connect Pages" },
    { ref = "Guide/Add Structure and Query" },
    { ref = "Guide/Make it your own" },
  },
  { name = "Guides", ref = "Guides", icon = "compass",
    description = "Practical tasks and workflows for personal knowledge, teams and documentation.",
    { ref = "Guide/Best Practices" },
    { ref = "Guide/Finding Content" },
    { ref = "Guide/Knowledge Base" },
    { ref = "Guide/Journal" },
    { ref = "Guide/Task Management" },
    { ref = "Guide/Aggregator Pages" },
    { ref = "Guide/Comments, Mentions and Replies" },
  },
  { name = "Setup and administration", ref = "Administration", icon = "settings",
    description = "Install and operate Desktop or Server, and protect your files.",
    { ref = "Install", label = "Choose Desktop or Server" },
    { ref = "Guide/Desktop Setup", label = "Desktop",
      { ref = "Install/Desktop", label = "Installation and updates" },
      { ref = "Local Space", label = "Local spaces" },
      { ref = "Desktop Sync", label = "Sync with a Server" },
    },
    { ref = "Guide/Server Setup", label = "Server",
      { ref = "Install/Docker", label = "Install with Docker" },
      { ref = "Install/Server Binary", label = "Install the binary" },
      { ref = "Authentication", label = "Access and authentication" },
      { ref = "Install/Network and Internet", label = "Network access" },
      { ref = "Deployments/Caddy" },
      { ref = "Install/Server", label = "Deployment and storage" },
    },
    { ref = "Guide/Git Sync" },
    { ref = "Troubleshooting" },
    { ref = "Log" },
  },
  { name = "Reference", ref = "Reference", icon = "bookmark",
    description = "Complete feature behavior, syntax and API contracts.",
    { ref = "Reference/Concepts", label = "Concepts",
      { ref = "Space" },
      { ref = "Page" },
      { ref = "Index Page" },
      { ref = "Tag", childrenFrom = "Tag/" },
      { ref = "Document" },
      { ref = "Folder" },
      { ref = "Aspiring Pages" },
      { ref = "Names" },
      { ref = "Paths" },
      { ref = "Link" },
      { ref = "Markdown/Anchor" },
      { ref = "Transclusions" },
      { ref = "Task" },
      { ref = "Page Template" },
      { ref = "Slash Templates" },
    },
    { ref = "Markdown",
      { ref = "Markdown/Basics" },
      { ref = "Markdown/Extensions" },
      { ref = "Markdown/Admonition" },
      { ref = "Markdown/Footnotes" },
      { ref = "Markdown/Fenced Code Block" },
      { ref = "Markdown/Syntax Highlighting" },
      { ref = "Markdown/HTML" },
      { ref = "Markdown/Comment", label = "Comments" },
    },
    { ref = "Reference/SilverBullet Features", label = "SilverBullet Features",
      { ref = "Glossary" },
      { label = "Navigation and editing",
        { ref = "Editor" },
        { ref = "Command Palette" },
        { ref = "Top Bar" },
        { ref = "Page Namer" },
        { ref = "Live Preview" },
        { ref = "Outlines" },
        { ref = "Completion" },
        { ref = "Slash Command" },
        { ref = "Linked Mention" },
        { ref = "Linked Tasks" },
        { ref = "Page Picker" },
        { ref = "Meta Picker" },
        { ref = "Anything Picker" },
        { ref = "Tag Picker" },
        { ref = "File Tree" },
        { ref = "Search" },
        { ref = "Graph View" },
        { ref = "X-Ray" },
        { ref = "Vim" },
        { ref = "Keyboard Shortcuts" },
      },
      { label = "Data and queries",
        { ref = "Object" },
        { ref = "Object Index" },
        { ref = "Metadata" },
        { ref = "Guide/When Results Update" },
        { ref = "Frontmatter" },
        { ref = "Attribute" },
        { ref = "YAML" },
        { ref = "Markdown/Hashtags" },
        { ref = "Schema" },
        { ref = "Live Object Edit" },
      },
      { ref = "Workbench",
        { ref = "Workbench/Overview" },
        { ref = "Workbench/Configuration" },
        { ref = "Workbench/Data" },
        { ref = "Workbench/Code",
          { ref = "Workbench/Code/Scripts" },
          { ref = "Workbench/Code/Styles" },
        },
        { ref = "Workbench/Libraries" },
        { ref = "Workbench/Maintenance" },
        { ref = "Workbench/Console" },
      },
      { label = "Collaboration and history",
        { ref = "Collaboration" },
        { ref = "Identity" },
        { ref = "At-Mention" },
        { ref = "Recipient" },
        { ref = "Authorship" },
        { ref = "Revisions" },
      },
      { label = "Storage, sync and publishing",
        { ref = "Sync" },
        { ref = "PWA" },
        { ref = "Git" },
        { ref = "Share" },
        { ref = "Publishing" },
        { ref = "Export" },
        { ref = "Baked Sections" },
      },
      { label = "Server and Desktop",
        { ref = "Dashboard" },
        { ref = "Desktop" },
        { ref = "Meta Space" },
        { ref = "Install/Server Modes" },
        { ref = "Install/Configuration" },
        { ref = "Account" },
        { ref = "Authentication Proxy" },
        { ref = "Single Sign-On" },
        { ref = "Authelia" },
        { ref = "Security" },
        { ref = "Zero Tracking" },
        { ref = "Security Profiles" },
        { ref = "TLS" },
        { ref = "Client Encryption" },
        { ref = "Licensing" },
      },
    },
    { ref = "Reference/Space Lua and APIs", label = "Space Lua and APIs",
      { ref = "Space Lua",
        { ref = "Space Lua/Page Lua" },
        { ref = "Space Lua/Standard Library" },
        { ref = "Space Lua/Conventions" },
        { ref = "Space Lua/Quirks" },
        { ref = "Space Lua/Thread Locals" },
        { ref = "Space Lua/JavaScript Interop" },
        { ref = "Space Lua/DOM" },
      },
      { ref = "Space Lua/Integrated Query", label = "Query language",
        { ref = "Space Lua/Integrated Query/Grouping" },
        { ref = "Space Lua/Integrated Query/Aggregating" },
      },
      { ref = "API", childrenFrom = "API/" },
      { label = "Customization and extensions",
        { ref = "Command" },
        { ref = "Template" },
        { ref = "Widget" },
        { ref = "View" },
        { ref = "Virtual Pages" },
        { ref = "Space Style" },
        { ref = "Page Decorations" },
        { ref = "Event" },
        { ref = "Service" },
        { ref = "Extensions" },
        { ref = "Library" },
        { ref = "Repository" },
        { ref = "Plugs" },
        { ref = "Document Editor" },
        { ref = "Meta Page" },
        { ref = "Library/Std/Config", label = "Configuration options" },
      },
    },
    { ref = "Reference/Technical Reference", label = "Technical reference",
      { label = "External interfaces",
        { ref = "CLI" },
        { ref = "MCP" },
        { ref = "HTTP API" },
        { ref = "Runtime API" },
        { ref = "URI" },
      },
      { label = "Architecture and project history",
        { ref = "Architecture", childrenFrom = "Architecture/" },
        { ref = "Plugs/Development/Architecture", label = "Plug architecture" },
        { ref = "Plugs/Development/Document Editors" },
        { ref = "Plugs/Development/Reference" },
        { ref = "ADR", childrenFrom = "ADR/" },
      },
      { ref = "Reference/Indexing Internals" },
    },
  },
  { name = "Contributing", ref = "Development", icon = "git-pull-request",
    description = "Build SilverBullet and develop libraries or plugs.",
    { ref = "Library/Development", label = "Develop a library" },
    { ref = "Plugs/Development", label = "Develop a plug" },
    { ref = "Plugs/Development/Distribution and Testing" },
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
  local ok, text = pcall(space.readPage, ref:match("^[^#]+"))
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
  local seenNames = {}
  for _, entry in ipairs(docsNav.pages) do
    if not existing[entry.ref:match("^[^#]+")] then
      table.insert(issues, "* Missing page `" .. entry.ref .. "` (at `" .. entry.name .. "`)")
    end
    if seenNames[entry.name] then
      table.insert(issues, "* Tree path used twice: `" .. entry.name .. "`")
    end
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
      local page = pages[entry.ref:match("^[^#]+")]
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

# Moved pages
Pages that moved keep their old links (from outside the site) working: the old name opens a stub pointing at the new page, and the client jumps there right away. On a fresh client, the jump waits until the first indexing pass has loaded this script.

```space-lua
docsRedirects = {
  ["Object/"] = "Tag/",
}

local function movedTo(pageName)
  for from, to in pairs(docsRedirects) do
    if pageName:startsWith(from) then
      return to .. pageName:sub(#from + 1)
    end
  end
end

-- The #heading of an old link followed within the site, kept in the history
-- state. On a cold load the client has dropped it before any Space Lua runs.
local movedHash = ""

for from, to in pairs(docsRedirects) do
  virtualPage.define {
    pattern = "^" .. from:gsub("%p", "%%%0") .. "(.+)$",
    run = function(rest)
      local state = js.window.history.state
      local details = state and state.details
      movedHash = details and details.type == "header"
        and "#" .. details.header or ""
      return "This page moved to " .. markdown.link(to .. rest) .. "."
    end,
  }
end

event.listen {
  name = "editor:pageLoaded",
  run = function()
    local target = movedTo(editor.getCurrentPage())
    if not target then
      return
    end
    -- Replace the history entry, so Back skips the stub
    editor.navigate(target .. movedHash, true)
    movedHash = ""
  end,
}

-- On a fresh client the page opens before indexing has loaded this script,
-- so neither the stub nor the listener existed yet: catch up now
local target = movedTo(editor.getCurrentPage() or "")
if target then
  editor.navigate(target, true)
end
```
