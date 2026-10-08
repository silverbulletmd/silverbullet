#meta

Implements general purpose widgets: buttons, sub-page lists, and visual building blocks for dashboards (chips, bars, number cards, grids).

## Docked widgets
* **Table of Contents** (`std.toc`, command `Navigate: Table of Contents`): the current page's headers as a tree, live as you type. Opens in the right sidebar. A page with fewer than `minHeaders` headers has no outline worth showing, and the view renders nothing at all in a page dock there.
* **Linked Mentions** (`std.linkedMentions`, command `Navigate: Linked Mentions`): every other page linking to this one, with a snippet of context. Docks at the bottom of the page, open until you close it.
* **Linked Tasks** (`std.linkedTasks`, command `Navigate: Linked Tasks`): incomplete tasks on other pages that link to this one. Docks at the top of the page, open until you close it.

None of the three has an `enabled` config key any more. Each remembers its own dock and open/closed state: close it with its ×, bring it back with its command, move it with its dock menu, and that choice is what applies from then on. The one knob left is how short an outline is too short to be worth showing:

```lua
-- Only show a table of contents on pages with >= 5 headers
config.set("std.widgets.toc.minHeaders", 5)
```

To set where a view docks space-wide — and whether it starts open, folded, or what size it uses — use `view.defaults` (`view.docks` and `navigator.docks` still work as dock-only fallbacks).

# Implementation

## Buttons
```space-lua
-- priority: 10
--- Renders a button that runs `callback` when clicked; `text` is shown literally.
--- @param text string the button label
--- @param callback function run on click
--- @param attrs? table extra attributes for the button element
--- @return table an inline widget
--- @see API/widgets
function widgets.button(text, callback, attrs)
  -- Labels are plain text: as markdown, ">" or "# 1" would render as blocks
  local buttonEl = {
    onclick = callback,
    __rawText = text
  }

  -- attrs can be used for additional customization
  if attrs then
    for k, v in pairs(attrs) do
      buttonEl[k] = v
    end
  end

  return widget.html(dom.button(buttonEl))
end

--- Renders a button that runs a command; with one argument it is both label and command name.
--- @param text string the button label (or the command name)
--- @param commandName? string the command to run
--- @param args? table arguments passed to the command
--- @return table an inline widget
--- @see API/widgets
function widgets.commandButton(text, commandName, args)
  if not commandName then
    -- When only passed one argument, then let's assume it's a command name
    commandName = text
  end
  return widget.html(dom.button {
    onclick = function()
      editor.invokeCommand(commandName, args)
    end,
    __rawText = text
  })
end

--- Lists the pages below a page.
--- @param pageName? string default the current page
--- @return table a markdown widget
--- @see API/widgets
function widgets.subPages(pageName)
  pageName = pageName or editor.getCurrentPage()
  return widget.markdown(table.concat(query[[
    from p = index.subPages(pageName)
    select templates.pageItem(p)
  ]]))
end
```

## Chips, bars, stats and grids
Built with the [[^Library/Std/APIs/DOM]] builder; labels go in as `dom.text`, so they stay literal. With `onClick` an element becomes a button (`role="button"`, focusable, Enter runs it too). Their CSS is in the Styles block below.
```space-lua
-- priority: 10
widgets = widgets or {}

local tones = {
  success = true, warning = true, danger = true,
  info = true, neutral = true, accent = true,
}

local function isColour(value)
  if type(value) ~= "string" or value == "" then return false end
  local css = js.window.CSS
  if css and css.supports then return css.supports("color", value) end
  return true
end

-- The class and style for a literal CSS colour if valid, else a tone name,
-- else the default tone
local function toneOf(tone, color, default)
  if isColour(color) then
    return "sb-tone-custom", {
      ["--sb-tone"] = color,
      ["--sb-tone-soft"] = "color-mix(in srgb, " .. color .. " 16%, transparent)",
    }
  end
  if tones[tone] then return "sb-tone-" .. tone, nil end
  return "sb-tone-" .. default, nil
end

local function text(s)
  if s == nil then return dom.text("") end
  return dom.text(tostring(s))
end

-- Makes an element act as a button for `handler`: click or Enter runs it
local function clickable(spec, handler)
  if handler then
    spec.role = "button"
    spec.tabindex = "0"
    spec.onclick = function() handler() end
    spec.onkeydown = function(e)
      if e.key == "Enter" then handler() end
    end
  end
  return spec
end

-- Reads a field (by name) or computes a value (by function) from a row
local function pick(row, getter)
  if type(getter) == "function" then return getter(row) end
  if getter == nil then return nil end
  return row[getter]
end

local function percent(fraction)
  if fraction ~= fraction or fraction < 0 then fraction = 0 end
  if fraction > 1 then fraction = 1 end
  return tostring(math.floor(fraction * 100 + 0.5)) .. "%"
end

local function empty(message)
  return widget.htmlBlock(dom.div { class = "sb-empty", dom.text(message) })
end

--- Renders a small rounded label in a tone colour
--- @param label string the text to show
--- @param opts? table `tone` (default "neutral"), `color` (CSS colour, used instead of the tone), `title` (tooltip), `onClick` (function run on click)
--- @return table an inline widget
--- @see API/widgets
function widgets.chip(label, opts)
  opts = opts or {}
  local toneClass, toneStyle = toneOf(opts.tone, opts.color, "neutral")
  return widget.html(dom.span(clickable({
    class = { "sb-chip", toneClass },
    style = toneStyle,
    title = opts.title,
    text(label),
  }, opts.onClick)))
end

--- Renders horizontal bars for counts or a distribution, one per row.
--- @param rows table a list or query result
--- @param opts? table `label`, `value` (field names or functions, default "label" and "value"), `tone` (name or function of the row, default the row's `tone` field, else "accent"), `color` (CSS colour or function of the row, used instead of the tone; default the row's `color` field), `max` (full-width value, default the largest), `onClick` (function run with the clicked row)
--- @return table a block widget
--- @see API/widgets
function widgets.bars(rows, opts)
  opts = opts or {}
  local labelOf = opts.label or "label"
  local valueOf = opts.value or "value"
  local items = {}
  local max = 0
  for _, row in ipairs(rows or {}) do
    local value = tonumber(pick(row, valueOf)) or 0
    local tone = opts.tone
    if type(tone) == "function" then
      tone = tone(row)
    elseif tone == nil and type(row) == "table" then
      tone = row.tone
    end
    local color = opts.color
    if type(color) == "function" then
      color = color(row)
    elseif color == nil and type(row) == "table" then
      color = row.color
    end
    table.insert(items, {
      label = pick(row, labelOf),
      value = value,
      tone = tone,
      color = color,
      row = row,
    })
    if value > max then max = value end
  end
  if #items == 0 then return empty("Nothing to show") end
  max = tonumber(opts.max) or max
  local bars = {}
  for _, item in ipairs(items) do
    local toneClass, toneStyle = toneOf(item.tone, item.color, "accent")
    table.insert(bars, dom.div(clickable({
      class = { "sb-bars-row", toneClass },
      style = toneStyle,
      dom.span { class = "sb-bars-label", text(item.label) },
      dom.span {
        class = "sb-bars-track",
        dom.span {
          class = "sb-bars-fill",
          style = { width = percent(max > 0 and item.value / max or 0) },
        },
      },
      dom.span { class = "sb-bars-value", text(item.value) },
    }, opts.onClick and function() opts.onClick(item.row) end)))
  end
  return widget.htmlBlock(dom.div { class = "sb-bars", bars })
end

--- Renders a number card, for use alone or in `widgets.grid`.
--- @param label string what the number is
--- @param value any the number (or short text) to show
--- @param opts? table `tone` (default "neutral"), `color` (CSS colour, used instead of the tone), `sub` (caption), `bar` (fraction 0..1 drawn as a thin bar), `onClick` (function run on click)
--- @return table a block widget
--- @see API/widgets
function widgets.stat(label, value, opts)
  opts = opts or {}
  local toneClass, toneStyle = toneOf(opts.tone, opts.color, "neutral")
  return widget.htmlBlock(dom.div(clickable({
    class = { "sb-stat", toneClass },
    style = toneStyle,
    dom.div { class = "sb-stat-label", text(label) },
    dom.div { class = "sb-stat-value", text(value) },
    opts.sub ~= nil and dom.div { class = "sb-stat-sub", text(opts.sub) },
    opts.bar ~= nil and dom.div {
      class = "sb-stat-bar",
      dom.span { style = { width = percent(tonumber(opts.bar) or 0) } },
    },
  }, opts.onClick)))
end

-- A grid cell: widgets and DOM nodes as they are (event handlers included),
-- markdown widgets rendered, text and numbers shown literally
local function cell(w)
  if type(w) == "table" and w._isWidget then
    if w.html == nil and w.markdown ~= nil then
      return widget.html(markdown.markdownToHtml(w.markdown))
    end
    return w
  end
  if type(w) == "string" or type(w) == "number" then
    return dom.div { class = "sb-grid-text", text(w) }
  end
  return w
end

--- Lays out widgets in a responsive grid.
--- @param items table a list or query result
--- @param fn? function returns the widget (or DOM node) for an item (default: the item itself)
--- @param opts? table `min`: minimum column width (default "12rem")
--- @return table a block widget
--- @see API/widgets
function widgets.grid(items, fn, opts)
  if type(fn) == "table" and opts == nil then
    opts, fn = fn, nil
  end
  opts = opts or {}
  local cells = {}
  for _, item in ipairs(items or {}) do
    local w = item
    if fn then w = fn(item) end
    table.insert(cells, cell(w))
  end
  if #cells == 0 then return empty("Nothing to show") end
  return widget.htmlBlock(dom.div {
    class = "sb-grid",
    style = opts.min and { ["--sb-grid-min"] = tostring(opts.min) } or nil,
    cells,
  })
end
```

### Styles
```space-style
/* Colours come from the tone tokens (Space Style#Tone colours), so both
   themes work; `color` sets --sb-tone/--sb-tone-soft inline instead. */
.sb-tone-success { --sb-tone: var(--tone-success); --sb-tone-soft: var(--tone-success-soft); }
.sb-tone-warning { --sb-tone: var(--tone-warning); --sb-tone-soft: var(--tone-warning-soft); }
.sb-tone-danger { --sb-tone: var(--tone-danger); --sb-tone-soft: var(--tone-danger-soft); }
.sb-tone-info { --sb-tone: var(--tone-info); --sb-tone-soft: var(--tone-info-soft); }
.sb-tone-neutral { --sb-tone: var(--tone-neutral); --sb-tone-soft: var(--tone-neutral-soft); }
.sb-tone-accent { --sb-tone: var(--tone-accent); --sb-tone-soft: var(--tone-accent-soft); }

/* Chips share the hashtag's geometry (editor.scss .sb-hashtag) so they sit in
   running text like tags do; the tone only sets the colours. */
.sb-chip {
  display: inline-block;
  padding: 0 4px;
  margin: 0 1px 0 0;
  border-radius: 6px;
  font-size: 0.9em;
  line-height: inherit;
  white-space: nowrap;
  vertical-align: baseline;
  color: var(--sb-tone, var(--tone-neutral));
  background: var(--sb-tone-soft, var(--tone-neutral-soft));
  border: 1px solid color-mix(in srgb, var(--sb-tone, var(--tone-neutral)) 25%, transparent);
}

/* widgets.* with onClick: role="button", focusable, Enter runs it too */
.sb-chip[role="button"],
.sb-stat[role="button"],
.sb-bars-row[role="button"] {
  cursor: pointer;
}

.sb-chip[role="button"]:hover {
  border-color: var(--sb-tone, var(--tone-neutral));
}

.sb-chip[role="button"]:focus-visible,
.sb-stat[role="button"]:focus-visible,
.sb-bars-row[role="button"]:focus-visible {
  outline: 2px solid var(--ui-accent-color);
  outline-offset: 1px;
}

.sb-bars {
  display: grid;
  grid-template-columns: minmax(4em, max-content) 1fr auto;
  gap: 0.3em 0.75em;
  align-items: center;
}

/* Each row spans the grid and lines its cells up with the others; a real
   box (not display: contents) so a clickable row can take focus. */
.sb-bars-row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  border-radius: 3px;
}

.sb-bars-row[role="button"]:hover {
  background: var(--ui-surface-hover-background-color);
}

.sb-bars-track {
  height: 0.55em;
  min-width: 4em;
  border-radius: 3px;
  overflow: hidden;
  background: var(--sb-tone-soft);
}

.sb-bars-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--sb-tone);
}

.sb-bars-value {
  text-align: right;
  color: var(--subtle-color);
  font-variant-numeric: tabular-nums;
}

/* Stat cards are flat surfaces like page widgets: a hairline border, no
   fill; the tone colours the number (except neutral) and the optional bar. */
.sb-stat {
  display: block;
  box-sizing: border-box;
  padding: 0.5em 0.75em;
  border: 1px solid var(--ui-surface-border-color);
  border-radius: 5px;
  color: inherit;
  text-decoration: none;
}

.sb-stat[role="button"]:hover {
  background: var(--ui-surface-hover-background-color);
}

.sb-stat-label {
  font-size: 0.85em;
  color: var(--subtle-color);
}

.sb-stat-value {
  font-size: 1.5em;
  font-weight: 600;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}

.sb-stat:not(.sb-tone-neutral) .sb-stat-value {
  color: var(--sb-tone);
}

.sb-stat-sub {
  font-size: 0.85em;
  color: var(--subtle-color);
}

.sb-stat-bar {
  height: 4px;
  margin-top: 0.4em;
  border-radius: 3px;
  overflow: hidden;
  background: var(--sb-tone-soft);
}

.sb-stat-bar > span {
  display: block;
  height: 100%;
  background: var(--sb-tone);
}

.sb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--sb-grid-min, 12rem), 1fr));
  gap: 0.75em;
}

/* Cards fill their column; chips and buttons keep their own width. */
.sb-grid > .sb-chip,
.sb-grid > button {
  justify-self: start;
  align-self: start;
}

/* Like the navigator's empty state (.sb-nav-empty) */
.sb-empty {
  font-size: 0.9em;
  color: var(--subtle-color);
}

/* A chip is its own frame, like a hashtag in running text: drop the inline
   widget frame around it. */
#sb-main .cm-editor .sb-lua-directive-inline:has(> .sb-chip) {
  border: none;
  border-radius: 0;
  padding: 0;
}
```

## Table of contents
```space-lua
-- priority: 10
widgets = widgets or {}

config.defineCategory {
  name = "Widgets",
  description = "Enable and configure built-in widgets (table of contents, linked mentions, etc.)",
  priority = 45,
}

-- The Table of Contents view has no `enabled` key -- it remembers its own dock
-- and open state -- but it does have a floor: a page with fewer headers than
-- this has no outline worth showing, so the view renders nothing at all there.
config.define("std.widgets.toc", {
  type = "object",
  properties = {
    minHeaders = {
      type = "number",
      default = 3,
      description = "Minimum number of headers required before rendering a table of contents at all.",
      ui = { category = "Widgets", label = "Minimum headers for TOC", priority = 3 },
    },
  }
})

-- Returns ATX headings as {name, pos, level}; defaults to the current page.
function widgets.tocHeaders(text)
  local parsedMarkdown = markdown.parseMarkdown(text or editor.getText())
  local headers = {}
  for topLevelChild in parsedMarkdown.children do
    if topLevelChild.type then
      local headerLevel = string.match(topLevelChild.type, "^ATXHeading(%d+)")
      if headerLevel then
        local label = ""
        table.remove(topLevelChild.children, 1)
        for child in topLevelChild.children do
          label = label .. string.trim(markdown.renderParseTree(child))
        end
        -- Strip link syntax to avoid nested brackets in TOC
        label = string.gsub(label, "%[%[(.-)%]%]", "%1")

        if label != "" then
          table.insert(headers, {
            name = label,
            pos = topLevelChild.from,
            level = tonumber(headerLevel)
          })
        end
      end
    end
  end
  return headers
end

```

### Table of Contents
```space-lua
-- priority: -1
view.define {
  name = "std.toc",
  title = "Table of Contents",
  placeholder = "Header",
  command = "Navigate: Table of Contents",
  menu = { location = "view", group = "1_views", order = 1, label = "Table of Contents" },
  dock = "rhs",
  supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "bhs", "modal" },
  defaultOpen = false,
  refreshOn = { "navigate", "edit" },
  refreshOnOpen = true,
  source = function(ctx)
    -- A document (not a page) has no markdown text for `tocHeaders` to read,
    -- and `editor.getText()` would answer with whatever page was open before.
    local path = editor.getCurrentPath()
    if not string.match(path, "%.md$") then
      return {}
    end
    local headers = widgets.tocHeaders()
    if ctx.dock == "page-top" or ctx.dock == "page-bottom" then
      local minHeaders = config.get("std.widgets.toc", {}).minHeaders or 3
      if #headers < minHeaders then
        return {}
      end
    end
    -- Nest by ancestor chain: nearest shallower header is the parent.
    local rows = {}
    local stack = {}
    local taken = {}
    for _, header in ipairs(headers) do
      while #stack > 0 and stack[#stack].level >= header.level do
        table.remove(stack)
      end
      -- "/" is the tree's path separator; look-alike keeps it literal.
      local nodePath = string.gsub(header.name, "/", "∕")
      if #stack > 0 then
        nodePath = stack[#stack].path .. "/" .. nodePath
      end
      while taken[nodePath] do
        nodePath = nodePath .. " @" .. header.pos
      end
      taken[nodePath] = true
      table.insert(stack, { level = header.level, path = nodePath })
      table.insert(rows, {
        name = nodePath,
        header = header.name,
        pos = header.pos,
      })
    end
    return rows
  end,
  presentation = {
    mode = "tree",
    expandAll = true,
    expansionScope = "page",
    foldersFirst = false,
    row = {
      primary = "header",
      label = "header",
      cssClass = function() return "sb-nav-noband" end,
    },
  },
  keymap = {
    [" "] = function(obj)
      editor.navigate { page = editor.getCurrentPage(), pos = obj.pos }
    end,
  },
  onSelect = function(obj)
    editor.navigate { page = editor.getCurrentPage(), pos = obj.pos }
  end,
}

```

## Linked mentions
```space-lua
-- priority: 10
widgets = widgets or {}

local mentionTemplate = template.new [==[
**[[${_.page}@${_.start}]]**:
${_.snippet}

]==]

function widgets.linkedMentionsMarkdown(pageName)
  pageName = pageName or editor.getCurrentPage()
  local linkedMentions = query[[
    from r = index.relations()
    where r.page != pageName
      and r.to == pageName
      and r.kind != "co-mention"
    order by r.pageLastModified desc, r.range[1]
    select mentionTemplate({
      page = r.page,
      snippet = r.snippet,
      start = r.range[1],
    })
  ]]
  if #linkedMentions == 0 then
    return ""
  end
  return table.concat(linkedMentions)
end

function widgets.linkedMentions(pageName)
  local md = widgets.linkedMentionsMarkdown(pageName)
  if md != "" then
    return widget.new {
      markdown = "# Linked Mentions\n" .. md
    }
  end
end

view.define {
  name = "std.linkedMentions",
  title = "Linked Mentions",
  command = "Navigate: Linked Mentions",
  menu = { location = "view", group = "1_views", order = 2, label = "Linked Mentions" },
  dock = "page-bottom",
  supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "bhs", "modal" },
  defaultOpen = true,
  refreshOn = { "navigate", "index" },
  refreshOnOpen = true,
  content = function()
    return widgets.linkedMentionsMarkdown()
  end,
}
```

## Linked tasks
```space-lua
-- priority: 10

-- Linked tasks as Markdown without a heading, or "" when empty.
-- taskItem includes page@pos refs so checkboxes write back to their source.
function widgets.linkedTasksMarkdown(pageName)
  pageName = pageName or editor.getCurrentPage()
  local tasks = query[[
    from t = index.tasks()
    where not t.done and table.includes(t.ilinks, pageName)
    order by t.page
    select templates.taskItem(t)
  ]]
  if #tasks == 0 then
    return ""
  end
  return table.concat(tasks)
end

function widgets.linkedTasks(pageName)
  local md = widgets.linkedTasksMarkdown(pageName)
  if md != "" then
    md = "# Linked Tasks\n" .. md
  end
  return widget.new {
    markdown = md
  }
end
```

### Top widget
```space-lua
-- priority: -1
-- A *content* view, like linked mentions: the tasks render as real markdown
-- tasks, so their checkboxes tick and write straight back to the page each
-- task lives on -- no need to navigate there first.
view.define {
  name = "std.linkedTasks",
  title = "Linked Tasks",
  command = "Navigate: Linked Tasks",
  menu = { location = "view", group = "1_views", order = 3, label = "Linked Tasks" },
  dock = "page-top",
  supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "bhs", "modal" },
  defaultOpen = true,
  refreshOn = { "navigate", "index" },
  refreshOnOpen = true,
  content = function()
    return widgets.linkedTasksMarkdown()
  end,
}
```
