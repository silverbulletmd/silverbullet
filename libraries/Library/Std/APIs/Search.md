---
description: Search the space with its active search backend
tags: meta/api
---
Defines the **Space: Search** command (`Ctrl-Shift-f`, `Cmd-Shift-f` on macOS), which searches every page with the space's search backend. Text selected in the editor (on a single line) becomes the initial search phrase. The modes in the dropdown come from the backend: with full text search that is "All words", "Exact phrase" and "Regex". See [Search](https://docs.silverbullet.md/Search) for setup, and [search API](https://docs.silverbullet.md/API/search) for the underlying API.

# Implementation
```space-lua
-- priority: 10
local modeLabels = {
  words = "All words",
  natural = "Meaning",
  phrase = "Exact phrase",
  regex = "Regex",
}

local ok, status = pcall(search.status)

if ok and status and status.backend then
  local modes = status.capabilities.modes
  local options = {}
  for i = 2, #modes do
    table.insert(options, {
      label = modeLabels[modes[i]] or modes[i],
      value = modes[i]
    })
  end

  local function trim(s)
    return (s or ""):match("^%s*(.-)%s*$")
  end

  view.define {
    name = "std.search",
    title = "Search",
    search = "source",
    dock = "modal",
    supportedDocks = { "modal", "lhs", "rhs", "bhs" },
    placeholder = "Search pages",
    refreshOnOpen = true,
    segments = {
      { label = "Pages", default = true, placeholder = "Search pages" },
      { label = "Meta", placeholder = "Search meta pages" },
      { label = "All", placeholder = "Search everything" },
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
      local result = search.find(q, { mode = ctx.dropdown or modes[1], scope = ctx.segment and ctx.segment:lower() })
      local rows = {}
      if result.notice then
        table.insert(rows, { notice = result.notice })
      end
      for _, m in ipairs(result.items) do
        table.insert(rows, m)
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

  -- A single-line selection in the editor becomes the initial search phrase.
  command.define {
    name = "Space: Search",
    key = "Ctrl-Shift-f",
    mac = "Cmd-Shift-f",
    run = function()
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
