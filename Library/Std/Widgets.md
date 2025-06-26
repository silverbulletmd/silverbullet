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
    disableTOC = { type = {"string", "boolean"} },
  }
}

-- Floating ToC
local REFRESH_ICON = [[<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>]]

local CLOSE_ICON = [[<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>]]

local LIST_ICON = [[<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-list"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>]]

local function trim(s)
  if not s or type(s) ~= "string" then
    return ""
  end
  return s:match("^%s*(.-)%s*$") or ""
end

local function escapeHtml(text)
  if not text or type(text) ~= "string" then
    return ""
  end

  local result = text
  result = result:gsub("&", "&amp;")
  result = result:gsub("<", "&lt;")
  result = result:gsub(">", "&gt;")
  result = result:gsub('"', "&quot;")

  return result
end

function widgets.floatingToc(options)
  options = options or {}
  local validationResult = jsonschema.validateObject(tocSchema, options)
  if validationResult then
    error(validationResult)
  end
  options.minHeaders = options.minHeaders or 2
  options.disableTOC = options.disableTOC or false

  local ok, result = pcall(function()
    local text = editor.getText()
    local pageName = editor.getCurrentPage()
    local parsedMarkdown = markdown.parseMarkdown(text)

  -- Collect all headers
  local headers = {}
  if parsedMarkdown and type(parsedMarkdown) == "table" and parsedMarkdown.children and type(parsedMarkdown.children) == "table" then
    for i, topLevelChild in ipairs(parsedMarkdown.children) do
      if topLevelChild and type(topLevelChild) == "table" and topLevelChild.type and type(topLevelChild.type) == "string" then
        local headerLevel = string.match(topLevelChild.type, "^ATXHeading(%d+)")
        if headerLevel then
          local text = ""
          if topLevelChild.children and type(topLevelChild.children) == "table" and #topLevelChild.children > 0 then
            -- Skip the first element if there's more than one element, otherwise process all
            local startIndex = (#topLevelChild.children > 1) and 2 or 1
            for i = startIndex, #topLevelChild.children do
              local child = topLevelChild.children[i]
              -- Check if child is valid and has either a type or text property
              if child and type(child) == "table" and (child.type or child.text) then
                local ok, renderedText = pcall(markdown.renderParseTree, child)
                if ok and renderedText and type(renderedText) == "string" then
                  text = text .. trim(renderedText)
                end
              end
            end
          end

          if text and text ~= "" then
            table.insert(headers, {
              name = text,
              pos = (topLevelChild.from and type(topLevelChild.from) == "number") and topLevelChild.from or 0,
              level = tonumber(headerLevel) or 1
            })
          end
        end
      end
    end
  end

  -- If not enough headers, return empty widget
  if options.minHeaders and options.minHeaders > #headers then
    return widget.new{}
  end

  -- Find min level
  local minLevel = 6
  for _, header in ipairs(headers) do
    if header and header.level then
      if header.level < minLevel then
        minLevel = header.level
      end
    end
  end

  -- Build floating ToC HTML from headers
  local tocClass = (options.disableTOC == "never") and "floating-toc-always-visible" or ""
  local tocHtml = [[
<div id="floating-toc" class="]] .. tocClass .. [[">
  <input type="checkbox" id="toc-toggle" class="toc-toggle">
  <label for="toc-toggle" class="toc-toggle-btn" title="Toggle Table of Contents">]] .. LIST_ICON .. [[</label>
  <div class="toc-main">
    <div class="toc-header">
      <h3>Contents</h3>
      <div class="toc-header-buttons">
        <button class="toc-refresh-btn" data-onclick='["command", "Widgets: Refresh All"]' title="Refresh TOC">]] .. REFRESH_ICON .. [[</button>
        <label for="toc-toggle" class="toc-close-btn" title="Close TOC">]] .. CLOSE_ICON .. [[</label>
      </div>
    </div>
    <div class="toc-content">]]

  -- Convert headers to HTML links
  for _, header in ipairs(headers) do
    if header and header.level and header.name and header.pos and
       not(options.maxHeader and header.level > options.maxHeader or
           options.minLevel and header.level < options.minLevel) then
      local indent = (header.level - minLevel) * 16
      tocHtml = tocHtml .. [[<div class="toc-item" style="margin-left: ]] .. indent .. [[px;">]]
      local escapedName = escapeHtml(header.name)
      tocHtml = tocHtml .. [[<a href="/]] .. (pageName or "") .. [[@]] .. header.pos .. [[" data-ref="]] .. (pageName or "") .. [[@]] .. header.pos .. [[">]] .. escapedName .. [[</a>]]
      tocHtml = tocHtml .. [[</div>]]
    end
  end

  tocHtml = tocHtml .. [[
    </div>
  </div>
</div>]]

    return widget.new {
      html = tocHtml
    }
  end)

  if not ok then
    print("ERROR in floatingToc:", result)
    return widget.new {
      html = '<div style="color: red; padding: 10px;">Error generating ToC: ' .. tostring(result) .. '</div>'
    }
  end

  return result
end

event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    local pageText = editor.getText()
    local fm = index.extractFrontmatter(pageText)

    -- Check disableTOC setting (default is false/show TOC)
    local disableTOC = false
    if fm.frontmatter and fm.frontmatter.pageDecoration and fm.frontmatter.pageDecoration.disableTOC ~= nil then
      disableTOC = fm.frontmatter.pageDecoration.disableTOC
    end

    -- Don't render
    if disableTOC == true or disableTOC == "true" then
      return
    end

    -- Floating ToC in invisible container avoids border
    local floatingToc = widgets.floatingToc({ disableTOC = disableTOC })
    if floatingToc.html then
      return widget.new {
        html = '<div class="toc-hidden-container"></div>' .. floatingToc.html
      }
    end
    return widget.new{}
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