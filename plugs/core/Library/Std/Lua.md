#meta

Editor support for Lua, implemented in Lua. Of course.

# Code complete support
```space-lua
local LUA_KEYWORDS = {"do", "if", "then", "for", "else", "end", "function", "local", "return"}

-- Are we in a comment?
local function inComment(line)
  return string.find(line, "%-%-")
end

-- Are we in a string?
local function inString(line)
  local singleQuotes = 0
  local doubleQuotes = 0
  local brackets = 0
  for i = 1, string.len(line) do
    local c = line[i]
    if c == "'" then
      singleQuotes = singleQuotes + 1
    elseif c == '"' then
      doubleQuotes = doubleQuotes + 1
    elseif c == "[" and line[i+1] == "[" and line:sub(i-5, i) != "query[" then
      brackets = brackets + 1
    elseif c == "]" and line[i-1] == "]" then
      brackets = brackets - 1
    end
  end
  return singleQuotes % 2 == 1 or doubleQuotes % 2 == 1 or brackets > 0
end

-- API code completion for Lua
-- Completes something.somethingelse APIs 
event.listen {
  name = "editor:complete",
  run = function(e)
    local parents = e.data.parentNodes
    local foundSpaceLua = false
    for _, parent in ipairs(parents) do
      if string.startsWith(parent, "FencedCode:space-lua") or parent == "LuaDirective" then
        foundSpaceLua = true
      end
    end
    if not foundSpaceLua then
      return
    end
    local linePrefix = e.data.linePrefix
    if inComment(linePrefix) or inString(linePrefix) then
      return
    end
    local pos = e.data.pos
    local propaccessPrefix = string.matchRegex(linePrefix, "([a-zA-Z_0-9]+\\.)*([a-zA-Z_0-9]*)$")
    if not propaccessPrefix or not propaccessPrefix[1] then
      -- No propaccess prefix, so we can't complete
      return
    end
    -- Split propaccess and traverse
    local propParts = string.split(propaccessPrefix[1], ".")
    local currentValue = _CTX._GLOBAL
    local failed = false
    for i = 1, #propParts-1 do
      local prop = propParts[i]
      if currentValue then
        currentValue = currentValue[prop]
      else
        failed = true
      end
    end
    if failed then
      return
    end
    local lastProp = propParts[#propParts]
    if table.includes(LUA_KEYWORDS, lastProp) then
      return
    end
    local options = {}
    if not currentValue then
      return
    end
    for key, val in pairs(currentValue) do
      if string.startsWith(key, lastProp) and val then
        if val.call then
          -- We got a function
          if val.body then
            -- Function defined in Lua
            table.insert(options, {
              label = key .. "(" .. table.concat(val.body.parameters, ", ") ..")",
              apply = key,
              detail = "Lua function"
            })
          else
            -- Builtin
            table.insert(options, {
              label = key .. "()",
              apply = key,
              detail = "Lua built-in"
            })
          end
        else
          -- Table
          table.insert(options, {
            label = key,
            detail = "Lua table"
          })
        end
      end
    end
    if #options > 0 then
      return {
        from = pos - string.len(lastProp),
        options = options
      }
    end
  end
}
```

# Navigation
Ctrl/Cmd-click navigation to Lua function definition.

```space-lua
local function inLuaContext(parentNodes)
  for _, node in ipairs(parentNodes) do
    if node == "LuaDirective"
      or node:startsWith("FencedCode:space-lua") then
      return true
    end
  end
  return false
end

event.listen {
  name = "page:click",
  run = function(e)
    if not e.data.metaKey or e.data.ctrlKey then
      return
    end
    if not inLuaContext(e.data.parentNodes) then
      return
    end
    local pos = e.data.pos
    local text = editor.getText()
    -- Find start pos
    local startPos = pos
    while string.match(text[startPos], "[a-zA-Z0-9._]") do
      startPos = startPos - 1
      if startPos <= 0 then
        return
      end
    end
    -- Find end pos
    local endPos = pos
    while string.match(text[endPos], "[a-zA-Z0-9_]") do
      endPos = endPos + 1
      if startPos >= #text then
        return
      end
    end
    local callText = text:sub(startPos+1, endPos-1)
    print("Potential call text", callText, #callText)
    local propParts = callText:split(".")
    local currentValue = _CTX._GLOBAL
    for i = 1, #propParts do
      local prop = propParts[i]
      if currentValue then
        currentValue = currentValue[prop]
      else
        return
      end
    end
    -- Check if this is a Lua-defined API
    if currentValue and currentValue.body and currentValue.body.ctx then
      local ctx = currentValue.body.ctx
      -- Parse out the position in the doc
      local refBits = ctx.ref:split("@")
      -- Navigate there
      editor.navigate({
        kind="page",
        page=refBits[1],
        -- Has to be offset a bit
        pos=tonumber(refBits[2]) + ctx.from + #"```space-lua\n"
      })
    end
  end
}
```

# Slash templates
Various useful slash templates.

```space-lua
template.defineSlashCommand {
  name = "function",
  description = "Lua function",
  onlyContexts = {"FencedCode:space-lua"},
  template = template.new [==[function |^|()
end]==]
}

template.defineSlashCommand {
  name = "tpl",
  description = "Lua template",
  onlyContexts = {"FencedCode:space-lua"},
  template = template.new "template.new[==[|^|]==]"
}

template.defineSlashCommand {
  name = "lua-query",
  description = "Lua query",
  onlyContexts = {"FencedCode:space-lua", "LuaDirective"},
  template = template.new 'query[[from index.tag "|^|"]]'
}

template.defineSlashCommand {
  name = "space-lua",
  description = "Space Lua block",
  exceptContexts = {"FencedCode:space-lua", "LuaDirective"},
  template = template.new [==[```space-lua
|^|
```]==]
}

-- A query embedded in ${}
template.defineSlashCommand {
  name = "query",
  description = "Lua query",
  exceptContexts = {"FencedCode:space-lua", "LuaDirective"},
  template = function() return '${query[[from index.tag "|^|"]]}' end
}
