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
* Table of contents: shows a table of contents for your page
* Linked mentions: show a list of links that link to the current page, at the bottom of your page
* Linked tasks: shows a list of tasks that link to the current page, at the top of the page

These can each be individually enabled/disabled and configured in your [[CONFIG]] page (use `space-lua` instead of `lua`):

```lua
-- Disable TOC altogether
config.set("std.widgets.toc.enabled", false)
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
  local prefix = (pageName or editor.getCurrentPage()) .. "/"
  return widget.markdown(template.each(query[[
    from index.tag "page"
    where string.startsWith(_.name, prefix)
  ]], templates.pageItem))
end
```

## Table of contents
```space-lua
-- priority: 10
widgets = widgets or {}

-- configuration schema
config.define("std.widgets.toc", {
  type = "object",
  properties = {
    enabled = schema.boolean(),
    minHeaders = schema.number(),
  }
})

-- configuration default values
config.set("std.widgets.toc", {
  enabled = true,
  minHeaders = 3
})

function widgets.toc(options)
  options = options or config.get("std.widgets.toc")
  options.minHeaders = options.minHeaders or 3
  local text = editor.getText()
  local pageName = editor.getCurrentPage()
  local parsedMarkdown = markdown.parseMarkdown(text)
  -- Collect all headers
  local headers = {}
  for topLevelChild in parsedMarkdown.children do
    if topLevelChild.type then
      local headerLevel = string.match(topLevelChild.type, "^ATXHeading(%d+)")
      if headerLevel then
        local text = ""
        table.remove(topLevelChild.children, 1)
        for child in topLevelChild.children do
          text = text .. string.trim(markdown.renderParseTree(child))
        end
        -- Strip link syntax to avoid nested brackets in TOC
        text = string.gsub(text, "%[%[(.-)%]%]", "%1")

        if text != "" then
          table.insert(headers, {
            name = text,
            pos = topLevelChild.from,
            level = tonumber(headerLevel)
          })
        end
      end
    end
  end
  if options.minHeaders and options.minHeaders > #headers then
    return widget.new{}
  end
  -- Find min level
  local minLevel = 6
  for _, header in ipairs(headers) do
    if header.level < minLevel then
      minLevel = header.level
    end
  end
  -- Build up markdown
  local md = (options.header or "# Table of Contents") .. "\n"
  for _, header in ipairs(headers) do
    if not(options.maxHeader and header.level > options.maxHeader or
           options.minLevel and header.level < options.minLevel) then
      md = md .. string.rep(" ", (header.level - minLevel) * 2) ..
         "* [[" .. pageName .. "@" .. header.pos .. "|" .. header.name .. "]]\n"
    end
  end
  return widget.new {
    markdown = md
  }
end
```

### Top widget
```space-lua
-- priority: -1
if config.get("std.widgets.toc.enabled") then
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
**[[${_.ref}]]**:
${_.snippet}

]==]

-- configuration schema
config.define("std.widgets.linkedMentions", {
  type = "object",
  properties = {
    enabled = schema.boolean(),
  }
})

-- configuration default values
config.set("std.widgets.linkedMentions", {
  enabled = true,
})

function widgets.linkedMentions(pageName)
  pageName = pageName or editor.getCurrentPage()
  local linkedMentions = query[[
    from index.tag "link"
    where _.page != pageName and _.toPage == pageName
    order by _.page desc, _.pos
  ]]
  if #linkedMentions > 0 then
    return widget.new {
      markdown = "# Linked Mentions\n"
        .. template.each(linkedMentions, mentionTemplate)
    }
  end
end
```

### Bottom widget
```space-lua
-- priority: -1
if config.get("std.widgets.linkedMentions.enabled") then
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
    enabled = schema.boolean(),
  }
})

-- configuration default values
config.set("std.widgets.linkedTasks", {
  enabled = true,
})

function widgets.linkedTasks(pageName)
  pageName = pageName or editor.getCurrentPage()
  local tasks = query[[
    from index.tag "task"
    where not _.done and table.includes(_.ilinks, pageName)
    order by _.page
  ]]
  local md = ""
  if #tasks > 0 then
    md = "# Linked Tasks\n"
       .. template.each(tasks, templates.taskItem)
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
if config.get("std.widgets.linkedTasks.enabled") then
  event.listen {
    name = "hooks:renderTopWidgets",
    run = function(e)
      return widgets.linkedTasks()
    end
  }
end
```
