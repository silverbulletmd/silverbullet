#meta

Editor support for Lua, implemented in Lua. Of course.

# Code complete support
```space-lua
local LUA_KEYWORDS = {"do", "if", "then", "for", "else", "end", "function", "local", "return"}

-- Are we in a comment?
local function inComment(line)
  return string.find(line, "--")
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
    elseif c == "[" and line[i+1] == "[" then
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
      if string.startswith(parent, "FencedCode:space-lua") or parent == "LuaDirective" then
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
      if string.startswith(key, lastProp) and val then
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


-- A query embedded in ${}
template.defineSlashCommand {
  name = "query",
  description = "Lua query",
  exceptContexts = {"FencedCode:space-lua", "LuaDirective"},
  template = function() return '${query[[from index.tag "|^|"]]}' end
}
