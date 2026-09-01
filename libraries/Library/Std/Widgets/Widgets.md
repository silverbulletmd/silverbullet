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

## Docked widgets
* **Table of Contents** (`std.toc`, command `Navigate: Table of Contents`): the current page's headers as a tree, live as you type. Opens as a modal. A page with fewer than `minHeaders` headers has no outline worth showing, and the view renders nothing at all in a page dock there.
* **Linked Mentions** (`std.linkedMentions`, command `Navigate: Linked Mentions`): every other page linking to this one, with a snippet of context. Docks at the bottom of the page, open until you close it.
* **Linked Tasks** (`std.linkedTasks`, command `Navigate: Linked Tasks`): incomplete tasks on other pages that link to this one. Docks at the top of the page, open until you close it.

None of the three has an `enabled` config key any more. Each remembers its own dock and open/closed state: close it with its ×, bring it back with its command, move it with its dock menu, and that choice is what applies from then on. The one knob left is how short an outline is too short to be worth showing:

```lua
-- Only show a table of contents on pages with >= 5 headers
config.set("std.widgets.toc.minHeaders", 5)
```

To set where a view docks space-wide — and whether it starts open, folded, or how wide — use `view.defaults` (`view.docks` and `navigator.docks` still work as dock-only fallbacks).

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

-- Every ATX heading in `text` (defaulting to the page being edited), as
-- `{name, pos, level}`: the text to show, the position to navigate to, and the
-- nesting depth. The single header extractor -- the `std.toc` view is its one
-- caller today, and anything else wanting the page's headers should use it
-- rather than parsing them again.
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
  dock = "modal",
  supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "modal" },
  defaultOpen = false,
  refreshOn = { "editor:pageModified", "editor:pageLoaded", "editor:documentLoaded" },
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
  supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "modal" },
  defaultOpen = true,
  refreshOn = { "editor:pageLoaded", "mq:emptyQueue:indexQueue" },
  refreshOnOpen = true,
  content = function()
    return widgets.linkedMentionsMarkdown()
  end,
}
```

## Linked tasks
```space-lua
-- priority: 10

-- The linked-task list as markdown, with no heading of its own -- the shared
-- builder behind `widgets.linkedTasks()` and the `std.linkedTasks` content
-- view. `templates.taskItem` renders each task with its `[[page@pos]]` ref,
-- which is what makes the rendered checkbox tick through to the page the task
-- actually lives on. Returns "" when nothing links here.
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
  supportedDocks = { "page-top", "page-bottom", "lhs", "rhs", "modal" },
  defaultOpen = true,
  refreshOn = { "editor:pageLoaded", "mq:emptyQueue:indexQueue" },
  refreshOnOpen = true,
  content = function()
    return widgets.linkedTasksMarkdown()
  end,
}
```
