#meta

Some useful widgets.

# Buttons
Types of button widgets:

* `widgets.button(text, callback)` renders a simple button running the callback when clicked
* `widgets.commandButton(commandName)` renders a button for a particular command (where the button text is the command name itself)
* `widgets.commandButton(text, commandName)` renders a button for a particular command with a custom button text
* `widgets.commandButton(text, commandName, args)` renders a button for a particular command and arguments (specified as a table list) with a custom button text

```space-lua
-- priority: 10
function widgets.button(text, callback)
  return widget.html(dom.button {
    onclick=callback,
    text
  })
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
```

Examples:

${widgets.button("Hello", function()
  editor.flashNotification "Hi there!"
end)}

${widgets.commandButton("System: Reload")}

# Table of contents
```space-lua
-- priority: 10
widgets = widgets or {}

local tocSchema = {
  type = "object",
  properties = {
    minHeaders = { type = "number" },
  }
}

function widgets.toc(options)
  options = options or {}
  local validationResult = jsonschema.validateObject(tocSchema, options)
  if validationResult then
    error(validationResult)
  end
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

        if text != "" then
          table.insert(headers, {
            name = text,
            pos = topLevelChild.from,
            level = headerLevel
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
      md = md .. string.rep(" ", (header.level - minLevel) * 2) +
         "* [[" .. pageName .. "@" .. header.pos .. "|" .. header.name .. "]]\n"
    end
  end
  return widget.new {
    markdown = md
  }
end

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
```

# Page Hierarchy
```space-lua
-- priority: 10
widgets = widgets or {}

function widgets.pageHierarchy(pageName)
  pageName = pageName or editor.getCurrentPage()

  if not string.find(pageName, "/") then
    return nil
  end

  local hierarchyItems = {}

  -- Extract parent path (everything before the last "/")
  local parentPath = string.match(pageName, "^(.+)/[^/]+$")
  if parentPath then
    -- Always add the immediate parent as the first item
    local parentDisplayName = parentPath:gsub("/", " > ")
    table.insert(hierarchyItems, "○ [[" .. parentPath .. "|" .. parentDisplayName .. "]]")
  end

  -- Query for all descendant pages that start with current page name + "/"
  local descendantPages = query[[
    from index.tag "page"
    where string.startsWith(_.name, pageName .. "/")
      and not string.startsWith(_.name, "_")
    order by name
  ]]

  -- Add descendant pages
  for _, page in ipairs(descendantPages) do
    local displayName = page.name:gsub("/", " > ")
    table.insert(hierarchyItems, "○ [[" .. page.name .. "|" .. displayName .. "]]")
  end

  if #hierarchyItems > 0 then
    return widget.new {
      markdown = "# Hierarchy\n" .. table.concat(hierarchyItems, "\n")
    }
  end

  return nil
end

event.listen {
  name = "hooks:renderBottomWidgets",
  run = function(e)
    return widgets.pageHierarchy()
  end
}
```

# Linked mentions
```space-lua
-- priority: 10
widgets = widgets or {}

local mentionTemplate = template.new [==[
**[[${_.ref}]]**
> ${_.snippet}

]==]

function widgets.linkedMentions(pageName)
  pageName = pageName or editor.getCurrentPage()
  local linkedMentions = query[[
    from index.tag "link"
    where _.page != pageName and _.toPage == pageName
    order by page
  ]]
  if #linkedMentions > 0 then
    return widget.new {
      markdown = "# Linked Mentions\n"
        .. template.each(linkedMentions, mentionTemplate)
    }
  end
end

event.listen {
  name = "hooks:renderBottomWidgets",
  run = function(e)
    return widgets.linkedMentions()
  end
}
```

# Linked tasks
```space-lua
-- priority: 10
function widgets.linkedTasks(pageName)
  pageName = pageName or editor.getCurrentPage()
  local tasks = query[[
    from index.tag "task"
    where not _.done
      and string.find(_.name, "[[" .. pageName .. "]]", 1, true)
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

event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    return widgets.linkedTasks()
  end
}
```