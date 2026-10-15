---
description: Search the space with its active search backend
tags: meta/api
---
Defines the **Space: Search** command (`Ctrl-Shift-f`, `Cmd-Shift-f` on macOS), which searches every page with the space's search backend. Reopening it brings back the last search in this browser tab (selected, so typing replaces it); text selected in the editor (on a single line) becomes the search phrase instead. The modes in the dropdown come from the backend: with full text search that is "All words" and "Exact phrase", and spaces with semantic search add "Semantic". Spaces with semantic search also get the **Related Pages** view (`std.relatedPages`, command **Navigate: Related Pages**): the pages closest in meaning to the current one, docked at the bottom of the page and open until you close it. It shows 5 pages; change that with `config.set("std.search.relatedPages", { limit = 8 })`. See [Search](https://docs.silverbullet.md/Search) for setup, and [search API](https://docs.silverbullet.md/API/search) for the underlying API.

# Implementation
```space-lua
-- priority: 10
local modeLabels = {
  words = "All words",
  natural = "Semantic",
  phrase = "Exact phrase",
}

local function trim(s)
  return (s or ""):match("^%s*(.-)%s*$")
end

-- The backend's modes (the first is the default), or nil without a backend.
local function readModes()
  local ok, status = pcall(search.status)
  if ok and status and status.backend then
    return status.capabilities.modes
  end
end

local modes = readModes()

if modes then
  local function listed(mode)
    for _, m in ipairs(modes) do
      if m == mode then return true end
    end
    return false
  end

  -- `mode` when the backend lists it, otherwise the default.
  local function resolve(mode)
    return listed(mode) and mode or modes[1]
  end

  local function sameModes(a, b)
    if #a ~= #b then return false end
    for i = 1, #a do
      if a[i] ~= b[i] then return false end
    end
    return true
  end

  local function find(q, mode, scope)
    return search.find(q, { mode = mode, scope = scope })
  end

  local defineView

  -- Re-reads the backend's modes and redefines the view when they changed,
  -- so the dropdown follows the backend.
  local function refreshModes()
    local fresh = readModes()
    if fresh and not sameModes(fresh, modes) then
      modes = fresh
      defineView()
    end
  end

  defineView = function()
    local options = {}
    for i = 2, #modes do
      table.insert(options, {
        label = modeLabels[modes[i]] or modes[i],
        value = modes[i]
      })
    end

    view.define {
      name = "std.search",
      title = "Search",
      search = "source",
      dock = "modal",
      supportedDocks = { "modal", "lhs", "rhs", "bhs" },
      placeholder = "Pages",
      refreshOnOpen = true,
      rememberPhrase = true,
      segments = {
        { label = "Pages", default = true, placeholder = "Pages" },
        { label = "Meta", placeholder = "Meta Pages" },
        { label = "All", placeholder = "All Pages" },
      },
      dropdown = {
        placeholder = "Search mode",
        allLabel = modeLabels[modes[1]] or modes[1],
        options = options,
      },
      presentation = {
        limit = 150,
        row = {
          primary = function(m) return m.notice or m.page end,
          description = function(m)
            if m.notice then return nil end
            return {
              text = m.excerpt,
              highlights = m.highlights
            }
          end,
        },
      },
      source = function(ctx)
        local q = trim(ctx.phrase)
        if q == "" then return {} end
        local scope = ctx.segment and ctx.segment:lower()
        -- A remembered mode the backend no longer lists runs as the default.
        local mode = resolve(ctx.dropdown)
        local ok, result = pcall(find, q, mode, scope)
        if not ok then
          -- The mode may have stopped being available (Semantic, for public
          -- visitors, while the index can't answer): re-read the modes and
          -- retry once with the default.
          refreshModes()
          local retry = resolve(mode)
          if retry == mode then error(result) end
          result = find(q, retry, scope)
        end
        local rows = {}
        if result.notice then
          table.insert(rows, { notice = result.notice })
        end
        -- One row per page: its first match is its best.
        local seen = {}
        for _, m in ipairs(result.items) do
          if not seen[m.page] then
            seen[m.page] = true
            table.insert(rows, m)
          end
        end
        return rows
      end,
      onSelect = function(m)
        if not m.page then return false end
        editor.navigate({
          path = m.page .. ".md",
          details = { type = "position", pos = m.pos }
        })
      end,
    }
  end

  defineView()

  -- A single-line selection in the editor becomes the search phrase; without
  -- one, the view reopens with the last search (rememberPhrase). The modes
  -- are read again on every opening.
  command.define {
    name = "Space: Search",
    key = "Ctrl-Shift-f",
    mac = "Cmd-Shift-f",
    run = function()
      refreshModes()
      local okSel, sel = pcall(editor.getSelection)
      local text = okSel and sel and trim(sel.text) or ""
      if text ~= "" and not text:find("\n") then
        view.open("std.search", { phrase = text })
      else
        view.open("std.search")
      end
      -- Returning false keeps the key binding from refocusing the editor over the panel.
      return false
    end,
  }
end
```

## Related Pages
```space-lua
-- priority: 10
config.define("std.search.relatedPages", {
  type = "object",
  properties = {
    limit = { type = "number", default = 5, description = "How many related pages to show." },
  },
})

-- Only spaces with semantic search can find related pages; like the Search
-- view's modes, this is read once at load.
local relatedOk, relatedStatus = pcall(search.status)
if relatedOk and relatedStatus and relatedStatus.backend == "semantic" then
  -- 2950 -> "2,950"
  local function count(n)
    local s = tostring(math.floor(n)):reverse():gsub("(%d%d%d)", "%1,"):reverse()
    return (s:gsub("^,", ""))
  end

  local function excerptOf(m)
    local text = (m.excerpt or ""):gsub("%s+", " "):match("^ ?(.-) ?$")
    if #text > 160 then text = text:sub(1, 160) .. "…" end
    return text
  end

  -- Related pages as Markdown, or "" when there is nothing to show. In a page
  -- dock an empty or not-yet-ready panel shows nothing at all; elsewhere a
  -- short line says why it is empty.
  local function relatedMarkdown(inPage)
    local function quiet(text)
      return inPage and "" or ("_" .. text .. "_")
    end
    local status = search.status()
    if not status.capabilities.related then
      local p = status.progress
      if p then
        return quiet("Related pages appear once the search index is ready (" .. count(p.done) .. " of " .. count(p.total) .. " pages).")
      end
      return quiet("Related pages appear once the search index is ready.")
    end
    local limit = config.get("std.search.relatedPages", {}).limit or 5
    -- Raises when the page isn't in the semantic index yet.
    local ok, result = pcall(search.related, editor.getCurrentPage(), { limit = limit, scope = "pages" })
    if not ok or #result.items == 0 then
      return quiet("No related pages.")
    end
    local lines = {}
    for _, m in ipairs(result.items) do
      table.insert(lines, "* [[" .. m.page .. "]]: " .. excerptOf(m))
    end
    return table.concat(lines, "\n")
  end

  view.define {
    name = "std.relatedPages",
    title = "Related Pages",
    command = "Navigate: Related Pages",
    menu = { location = "view", group = "1_views", order = 4, label = "Related Pages" },
    dock = "page-bottom",
    supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "bhs", "modal" },
    defaultOpen = true,
    refreshOnOpen = true,
    content = function(ctx)
      local inPage = ctx and (ctx.dock == "page-top" or ctx.dock == "page-bottom")
      local md = relatedMarkdown(inPage)
      if md == "" then return "" end
      -- Excerpts quote other pages verbatim: show them, don't run them
      return widget.markdown(md, { evaluate = false })
    end,
  }
end
```
