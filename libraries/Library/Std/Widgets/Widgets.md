#meta

Implements some useful general purpose widgets. Specifically:

## Buttons
Types of button widgets:

* `widgets.button(text, callback)` renders a simple button running the callback when clicked
* `widgets.commandButton(commandName)` renders a button for a particular command (where the button text is the command name itself)
* `widgets.commandButton(text, commandName)` renders a button for a particular command with a custom button text
* `widgets.commandButton(text, commandName, args)` renders a button for a particular command and arguments (specified as a table list) with a custom button text

Examples:

${widgets.button("Hello", function()
  editor.flashNotification "Hi there!"
end)}

${widgets.commandButton("System: Reload")}

## Top and bottom widgets
* Table of contents: shows a table of contents for your page — **off by default**; the `Navigator: Table of Contents` and `Navigator: Outline Picker` commands show the same headers on demand instead (see [[#Outline views]])
* Linked mentions: show a list of links that link to the current page, at the bottom of your page
* Linked tasks: shows a list of tasks that link to the current page, at the top of the page

These can each be individually enabled/disabled and configured in your `CONFIG` page (use `space-lua` instead of `lua`):

```lua
-- Put the TOC back at the top of every page
config.set("std.widgets.toc.enabled", true)
-- Only render a TOC when there's >= 5 headers
config.set("std.widgets.toc.minHeaders", 5)
-- Disable linked mentions altogether
config.set("std.widgets.linkedMentions.enabled", false)
-- Disable linked tasks altogether
config.set("std.widgets.linkedTasks.enabled", false)
```

# Implementation

## Buttons
```space-lua
-- priority: 10
function widgets.button(text, callback, attrs)
  local buttonEl = {
    onclick = callback,
    text
  }

  -- attrs can be used for additional customization
  if attrs then
    for k, v in pairs(attrs) do
      buttonEl[k] = v
    end
  end

  return widget.html(dom.button(buttonEl))
end

function widgets.commandButton(text, commandName, args)
  if not commandName then
    -- When only passed one argument, then let's assume it's a command name
    commandName = text
  end
  return widget.html(dom.button {
    onclick = function()
      editor.invokeCommand(commandName, args)
    end,
    text
  })
end

function widgets.subPages(pageName)
  pageName = pageName or editor.getCurrentPage()
  return widget.markdown(table.concat(query[[
    from p = index.subPages(pageName)
    select templates.pageItem(p)
  ]]))
end
```

## Table of contents
```space-style
.sb-toc-summary {
  cursor: pointer;
  font-weight: bold;
  user-select: none;
  padding: 15px 10px;
  margin: -10px -10px 0 -10px;
  background-color: var(--editor-widget-background-color);
}
.sb-toc-content {
  padding-top: 0.5rem;
}
.sb-toc-item {
  padding: 0.1rem 0;
}
.sb-toc-link {
  cursor: pointer;
  text-decoration: none;
}
```

```space-lua
-- priority: 10
widgets = widgets or {}

config.defineCategory {
  name = "Widgets",
  description = "Enable and configure built-in widgets (table of contents, linked mentions, etc.)",
  priority = 45,
}

-- configuration schema
config.define("std.widgets.toc", {
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      default = false,
      description = "Show a table of contents at the top of pages (off by default: the Outline navigator views show one on demand instead)",
      ui = { category = "Widgets", label = "Table of Contents", priority = 4 },
    },
    minHeaders = {
      type = "number",
      default = 3,
      description = "Minimum number of headers required before rendering a table of contents at all.",
      ui = { category = "Widgets", label = "Minimum headers for TOC", priority = 3 },
    },
  }
})

-- Every ATX heading in `text` (defaulting to the page being edited), as
-- `{name, pos, level}`: the text to show, the position to navigate to, and the
-- nesting depth. Shared by the table-of-contents widget and the navigator
-- outline views, so the two can never disagree about what a header is called
-- or where it starts.
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

function widgets.toc(options)
  options = options or config.get("std.widgets.toc", {})
  options.minHeaders = options.minHeaders or 3
  options.minLevel = options.minLevel or 1
  options.header = options.header or "Table of Contents"
  local defaultOpen = (options.defaultOpen ~= false) or nil

  local pageName = editor.getCurrentPage()
  local headers = widgets.tocHeaders(editor.getText())

  if options.minHeaders and options.minHeaders > #headers then
    return widget.new{}
  end

  -- Filter headers to display
  local headersToDisplay = {}
  for _, header in ipairs(headers) do
    if not (options.maxHeader and header.level > options.maxHeader or
            header.level < options.minLevel) then
      table.insert(headersToDisplay, header)
    end
  end
  
  -- Find min level
  local minLevel = 6
  for _, header in ipairs(headersToDisplay) do
    minLevel = math.min(minLevel, header.level)
  end

  -- Build a nested ul/li structure based on heading levels
  local function buildTocList(headers)
    local root = dom.ul {  }
    local stack = { { node = root, level = minLevel - 1, lastLi = nil } }

    for _, header in ipairs(headers) do
      -- Pop back up when heading is at same or higher level
      while #stack > 1 and stack[#stack].level >= header.level do
        table.remove(stack)
      end

      -- Open nested <ul>s for deeper headings
      while stack[#stack].level < header.level - 1 do
        local newUl = dom.ul {}
        -- Attach nested list to the last <li> in the current level, or create one if needed
        local parent = stack[#stack].lastLi or dom.li {}
        if not stack[#stack].lastLi then
          stack[#stack].node.appendChild(parent)
        end
        parent.appendChild(newUl)
        table.insert(stack, { node = newUl, level = stack[#stack].level + 1, lastLi = nil })
      end

      -- Create the <li> with link
      local li = dom.li {
        dom.a {
          onclick = function()
            editor.navigate({ page = pageName, pos = header.pos })
          end,
          class = "sb-toc-link",
          __rawText = header.name
        }
      }
      stack[#stack].node.appendChild(li)
      stack[#stack].lastLi = li
    end

    return root
  end

  -- Wrap in a <details> element for native show/hide toggle
  return widget.new {
    html = dom.details {
      open = defaultOpen,
      dom.summary {
        class = "sb-toc-summary",
        options.header
      },
      buildTocList(headersToDisplay)
    },
    display = "block"
  }
end
```

### Top widget
```space-lua
-- priority: -1
if config.get("std.widgets.toc.enabled", false) then
  event.listen {
    name = "hooks:renderTopWidgets",
    run = function(e)
      local pageText = editor.getText()
      local fm = index.extractFrontmatter(pageText)
      if fm.frontmatter.pageDecoration and fm.frontmatter.pageDecoration.disableTOC then
        return
      end
      return widgets.toc()
    end
  }
end
```

### Outline views
The same headers as a [[Library/Std/APIs/Navigator|navigator]] tree, on demand: `Navigator: Table of Contents` docks one in the right sidebar, `Navigator: Outline Picker` opens the same outline as a modal. Both are live — they re-read the editor's buffer as you type — and both start fully expanded.

```space-lua
-- priority: 5

-- "/" is the tree's own separator, so a header containing one would split into
-- two levels. Only the path is escaped; the row's label is the header verbatim.
local PATH_SLASH = "∕" -- U+2215 DIVISION SLASH

-- The current page's headers as navigator rows, nested by their ancestor
-- chain: the nearest preceding shallower header is the parent, so an H1 -> H3
-- jump nests without inventing an empty H2 between them.
local function outlineRows()
  -- A document (or nothing open yet) has no headers -- and no markdown to
  -- read them out of; `editor.getText()` is whatever the document editor
  -- shows, not a page buffer. An empty result (not an error) is what lets
  -- the panel replace the previous page's rows with its normal empty state,
  -- rather than keeping them on screen (the engine's failed-load behavior
  -- for a broken source).
  if string.sub(editor.getCurrentPath(), -3) ~= ".md" then return {} end
  local pageName = editor.getCurrentPage()
  local rows = {}
  local stack = {}
  local taken = {}
  for _, header in ipairs(widgets.tocHeaders(editor.getText())) do
    while #stack > 0 and stack[#stack].level >= header.level do
      table.remove(stack)
    end
    local path = string.gsub(header.name, "/", PATH_SLASH)
    if #stack > 0 then path = stack[#stack].path .. "/" .. path end
    -- Two identical sibling headers share a path, and the tree would show one
    -- row where there are two. `pos` is unique per header and never displayed.
    while taken[path] do path = path .. " @" .. header.pos end
    taken[path] = true
    stack[#stack + 1] = { level = header.level, path = path }
    rows[#rows + 1] = {
      name = path,
      header = header.name,
      page = pageName,
      pos = header.pos,
      level = header.level,
    }
  end
  return rows
end

local function jumpTo(obj)
  editor.navigate({ page = obj.page, pos = obj.pos })
end

-- One spec, two docks: an outline is the same thing in either, so the overlay
-- is the whole of the difference between them.
local function outlineView(over)
  local spec = {
    title = "Outline",
    placeholder = "Header",
    presentation = {
      mode = "tree",
      expandAll = true,
      -- These paths are one page's header text, so they mean nothing on any
      -- other page: a collapse lasts while you are on the page and is gone
      -- when you leave it. Without this, collapsing "Install" here would
      -- collapse "Install" on every page that has one, forever.
      expansionScope = "page",
      -- Document order, always: hoisting the headers that happen to have
      -- children would reorder the page.
      foldersFirst = false,
      -- The path carries escaping and disambiguation; the label is the header.
      -- The class drops the tree's folder bands (see navigator.scss): all but
      -- the leaf headers of an outline head a section, so a band on nearly
      -- every row reads as stripes, and the indentation says it already.
      row = {
        primary = "header",
        label = "header",
        cssClass = function() return "sb-nav-noband" end,
      },
    },
    -- The buffer rather than the file: `editor.getText()` is what is on screen,
    -- so the outline follows typing, debounced by the panel. Deliberately no
    -- row icons, no actions and no filter predicates -- each would add a round
    -- trip to every one of those refreshes.
    refreshOn = { "editor:pageModified" },
    refreshOnOpen = true,
    onSelect = jumpTo,
    source = outlineRows,
  }
  for key, value in pairs(over) do spec[key] = value end
  return spec
end

navigator.define(outlineView {
  name = "std.toc",
  command = "Navigator: Table of Contents",
  dock = "rhs",
  -- A sidebar is still up after you navigate, so it has to re-source for the
  -- page that just arrived. The modal is not: it dismisses on selection, and
  -- `refreshOnOpen` already gives it the current page every time it opens --
  -- where a `pageLoaded` in its refreshOn would be forwarded to every other
  -- view that later takes the same dock. `documentLoaded` is the same idea
  -- for navigating to a non-markdown file: without it the panel never
  -- re-sources on that navigation at all, and keeps showing the departed
  -- page's headers.
  refreshOn = { "editor:pageModified", "editor:pageLoaded", "editor:documentLoaded" },
  keymap = {
    -- Peek, as the page tree has it: jump to the header without leaving the
    -- panel, so the next arrow keeps browsing the outline.
    [" "] = jumpTo,
  },
})

navigator.define(outlineView {
  name = "std.tocModal",
  label = "Outline",
  command = "Navigator: Outline Picker",
  dock = "modal",
})
```

## Linked mentions
```space-lua
-- priority: 10
widgets = widgets or {}

local mentionTemplate = template.new [==[
**[[${_.page}@${_.start}]]**:
${_.snippet}

]==]

-- configuration schema
config.define("std.widgets.linkedMentions", {
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      default = true,
      description = "Show linked mentions at the bottom of pages",
      ui = { category = "Widgets", label = "Linked mentions", priority = 2 },
    },
  }
})

function widgets.linkedMentions(pageName)
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
  if #linkedMentions > 0 then
    return widget.new {
      markdown = "# Linked Mentions\n" .. table.concat(linkedMentions)
    }
  end
end
```

### Bottom widget
```space-lua
-- priority: -1
if config.get("std.widgets.linkedMentions.enabled", true) then
  event.listen {
    name = "hooks:renderBottomWidgets",
    run = function(e)
      return widgets.linkedMentions()
    end
  }
end
```

## Linked tasks
```space-lua
-- priority: 10

-- configuration schema
config.define("std.widgets.linkedTasks", {
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      default = true,
      description = "Show linked tasks at the top of pages",
      ui = { category = "Widgets", label = "Linked tasks", priority = 1 },
    },
  }
})

function widgets.linkedTasks(pageName)
  pageName = pageName or editor.getCurrentPage()
  local tasks = query[[
    from t = index.tasks()
    where not t.done and table.includes(t.ilinks, pageName)
    order by t.page
    select templates.taskItem(t)
  ]]
  local md = ""
  if #tasks > 0 then
    md = "# Linked Tasks\n" .. table.concat(tasks)
  else
    md = ""
  end
  return widget.new {
    markdown = md
  }
end
```

### Top widget
```space-lua
-- priority: -1
if config.get("std.widgets.linkedTasks.enabled", true) then
  event.listen {
    name = "hooks:renderTopWidgets",
    run = function(e)
      return widgets.linkedTasks()
    end
  }
end
```
