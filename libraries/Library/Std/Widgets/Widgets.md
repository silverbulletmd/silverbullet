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
* Table of contents: shows a table of contents for your page — **off by default**; the `Navigate: Outline` and `Navigate: Outline Picker` commands show the same headers on demand instead
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

  local headersToDisplay = {}
  for _, header in ipairs(headers) do
    if not (options.maxHeader and header.level > options.maxHeader or
            header.level < options.minLevel) then
      table.insert(headersToDisplay, header)
    end
  end
  
  local minLevel = 6
  for _, header in ipairs(headersToDisplay) do
    minLevel = math.min(minLevel, header.level)
  end

  local function buildTocList(headers)
    local root = dom.ul {  }
    local stack = { { node = root, level = minLevel - 1, lastLi = nil } }

    for _, header in ipairs(headers) do
      while #stack > 1 and stack[#stack].level >= header.level do
        table.remove(stack)
      end

      while stack[#stack].level < header.level - 1 do
        local newUl = dom.ul {}
        local parent = stack[#stack].lastLi or dom.li {}
        if not stack[#stack].lastLi then
          stack[#stack].node.appendChild(parent)
        end
        parent.appendChild(newUl)
        table.insert(stack, { node = newUl, level = stack[#stack].level + 1, lastLi = nil })
      end

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

## Linked mentions
```space-lua
-- priority: 10
widgets = widgets or {}

local mentionTemplate = template.new [==[
**[[${_.page}@${_.start}]]**:
${_.snippet}

]==]

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
