Widgets, styles and redirects for the docs.silverbullet.md site and Desktop’s built-in Help. Navigation is the plain Space Tree, ordered by [[^Library/Space Tree Structure]].

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

html[data-sb-scheme="dark"] .website-warning {
  background-color: #403521;
}
```

# Moved pages
Pages that moved keep their old links (from outside the site) working: the old name opens a stub pointing at the new page, and the client jumps there right away. A key in `docsRedirects` ending in `/` moves every page under that prefix; any other key moves that one page.

Most pages need no entry: when a visit starts at an old name that no longer exists, it goes to the page whose name ends in `/<old name>`, or failing that in its last segment, preferring an exact-case match and then the shortest name. So `Editor` finds `Features/Editor` and `API/editor` finds `Reference/API/editor`. Entries are only needed for removed pages, pages whose last part changed, and names several pages now end in (`Extensions` matches both `Reference/Markdown/Extensions` and `Reference/Concepts/Extensions`), where the fallback's choice could pick the wrong one or change as pages move.

```space-lua
docsRedirects = {
  -- Earlier renames
  ["Object/"] = "Reference/Tag/",
  ["Object/link"] = "Reference/Concepts/Link",
  ["File Tree"] = "Features/Space Tree",
  ["API/keyboardBar"] = "Reference/API/markupBar",
  ["Meta Page"] = "Reference/Concepts/Tool Page",
  ["Meta Picker"] = "Features/Tool Page Picker",
  ["Tool Picker"] = "Features/Tool Page Picker",
  ["CONFIG"] = "Library/Config",
  -- Removed pages
  ["index"] = "SilverBullet",
  ["Manual"] = "SilverBullet",
  ["Guide"] = "Guides",
  ["Writing"] = "Getting Started",
  ["Discovery"] = "Guides/Finding Content",
  ["Linking and Exploring"] = "Guides/Finding Content",
  ["Guide/Finding Your Notes"] = "Guides/Finding Content",
  ["Guide/Find and Connect Your Notes"] = "Getting Started/Find and Connect Pages",
  ["Guide/Devices and Publishing"] = "Administration",
  ["Guide/Working Together"] = "Features/Collaboration",
  ["Full Text Search"] = "Features/Search",
  ["Object Graph"] = "Features/Graph View",
  ["Queries and Data"] = "Features",
  ["Configuration Manager"] = "Features/Workbench/Configuration",
  ["Deployments/Caddy"] = "Administration/Server/Network and Internet",
  ["Migrate from v1"] = "CHANGELOG",
  ["Customizing"] = "Getting Started/Make it your own",
  ["Desktop Updates"] = "Administration/Desktop",
  ["Install/Server Modes"] = "Administration/Server",
  -- Renamed when the docs moved into folders
  ["Reference/SilverBullet Features"] = "Features",
  ["Reference/Space Lua and APIs"] = "Reference/Space Lua",
  ["Reference/Technical Reference"] = "Reference/Internals",
  ["Guide/Desktop Setup"] = "Administration/Desktop",
  ["Guide/Server Setup"] = "Administration/Server",
  ["Install/Desktop"] = "Administration/Desktop/Install",
  ["Install/Server"] = "Administration/Server/Server Deployment",
  ["Install/Configuration"] = "Administration/Server/Configuration",
  ["Library/Development"] = "Development/Library Development",
  ["Plugs/Development"] = "Development/Plug Development",
  ["Plugs/Development/Architecture"] = "Reference/Internals/Plugs/Plug Architecture",
  ["Plugs/Development/Document Editors"] = "Reference/Internals/Plugs/Plug Document Editors",
  ["Plugs/Development/Reference"] = "Reference/Internals/Plugs/Plug Reference",
  -- Old names several pages now end in, pinned so the choice can't drift
  ["Desktop"] = "Features/Desktop",
  ["Editor"] = "Features/Editor",
  ["Extensions"] = "Reference/Concepts/Extensions",
  ["Install"] = "Administration/Install",
  ["Plugs"] = "Reference/Internals/Plugs",
  ["Space Lua"] = "Reference/Space Lua",
}

local function isPrefix(from)
  return from:endsWith("/")
end

-- An exact key wins over a prefix (`Object/link` over `Object/`)
local function movedTo(pageName)
  local exact = docsRedirects[pageName]
  if exact and not isPrefix(pageName) then
    return exact
  end
  for from, to in pairs(docsRedirects) do
    if isPrefix(from) and pageName:startsWith(from) then
      return to .. pageName:sub(#from + 1)
    end
  end
end

-- The page an old name now lives at: the page whose name ends in the old
-- name, or failing that in its last segment (`Guide/Journal` finds
-- `Guides/Journal`). `nil` when the name exists or nothing matches.
local function movedBySuffix(pageName)
  if pageName == "" or space.pageExists(pageName) then
    return nil
  end
  local function find(oldName)
    local suffix = "/" .. oldName:lower()
    local best, bestExact
    for _, page in ipairs(query[[from index.pages()]]) do
      local name = page.name
      -- Bundled library pages share names with docs pages (Template, Search)
      if not name:startsWith("Library/")
        and ("/" .. name:lower()):endsWith(suffix) then
        local exact = ("/" .. name):endsWith("/" .. oldName)
        if not best
          or (exact and not bestExact)
          or (exact == bestExact and #name < #best) then
          best, bestExact = name, exact
        end
      end
    end
    return best
  end
  return find(pageName) or find(pageName:match("[^/]+$"))
end

-- The #heading of an old link followed within the site, kept in the history
-- state. On a cold load the client has dropped it before any Space Lua runs.
local movedHash = ""

for from, to in pairs(docsRedirects) do
  local escaped = from:gsub("%p", "%%%0")
  virtualPage.define {
    pattern = "^" .. escaped .. (isPrefix(from) and "(.+)$" or "$"),
    run = function(rest)
      local state = js.window.history.state
      local details = state and state.details
      movedHash = details and details.type == "header"
        and "#" .. details.header or ""
      if not isPrefix(from) then
        rest = ""
      end
      return "This page moved to " .. markdown.link(to .. rest) .. "."
    end,
  }
end

-- Old names only arrive from outside, as the page a visit starts at; later
-- navigation follows the site's own (current) links. Limiting the suffix
-- fallback to that page keeps it from redirecting a page someone opens to
-- create, such as `Guides/Search`. It stays allowed until another page loads,
-- because the index may not be ready on the first try.
local arrivalPage = js.window.decodeURIComponent(
  js.window.location.pathname:sub(2))

local function redirectTarget(page)
  local target = movedTo(page)
  if not target and page == arrivalPage then
    target = movedBySuffix(page)
  end
  if page ~= arrivalPage then
    arrivalPage = nil
  end
  return target
end

event.listen {
  name = "editor:pageLoaded",
  run = function()
    local target = redirectTarget(editor.getCurrentPage())
    if not target then
      return
    end
    -- Replace the history entry, so Back skips the stub
    editor.navigate(target .. movedHash, true)
    movedHash = ""
  end,
}

-- The first page can open before this script has run, so neither the stub
-- nor the listener existed yet: catch up now
local current = editor.getCurrentPage()
local target = current and redirectTarget(current)
if target then
  editor.navigate(target, true)
end
```
