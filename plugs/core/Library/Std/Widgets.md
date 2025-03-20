#meta

Some useful widgets.

## Button
A simple button.

```space-lua
widgets = widgets or {}
function widgets.button(text, callback)
  options = options or {}
  return widget.new {
    html = "<button>" .. text .. "</button>",
    events = { click = callback }
  }
end
```

Example:
${widgets.button("Hello", function()
  editor.flashNotification "Hi there!"
end)}

## Table of contents
```space-lua
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
  local lines = string.split(text, "\n")
  local tocTexts = {}
  for _, line in ipairs(lines) do
    local headerStart, headerEnd = string.find(line, "^(%#)+")
    if headerStart then
      local headerText = line:sub(headerEnd+2)
      table.insert(tocTexts, string.rep(" ", (headerEnd-1) * 2)
        .. "* [[" .. pageName .. "#" .. headerText .. "|" .. headerText .. "]]")
    end
  end
  if #tocTexts >= options.minHeaders then
    local fullText = "# Table of Contents\n" .. table.concat(tocTexts, "\n")
    return widget.new {
      markdown = fullText
    }
  else
    return ""
  end
end

event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    return widgets.toc()
  end
}
```

# Linked mentions
```space-lua
widgets = widgets or {}

local mentionTemplate = template.new [==[
* [[${_.ref}]]: “${_.snippet}”
]==]

function widgets.linkedMentions()
  local pageName = editor.getCurrentPage()
  local linkedMentions = query[[
    from index.tag "link"
    where _.page != pageName and _.toPage == pageName
    order by page
  ]]
  if #linkedMentions > 0 then
    return widget.new {
      markdown = "# Linked Mentions"
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
