#meta

Editor support for Lua, implemented in Lua. Of course.

# Code complete support
```space-lua
local LUA_KEYWORDS = {"do", "if", "then", "for", "else", "end", "function", "local", "return"}

-- Are we in a comment?
local function in_comment(line)
  return string.find(line, "--")
end

-- Are we in a string?
local function in_string(line)
  local single_quotes = 0
  local double_quotes = 0
  local brackets = 0
  for i = 1, string.len(line) do
    local c = line[i]
    if c == "'" then
      single_quotes = single_quotes + 1
    elseif c == '"' then
      double_quotes = double_quotes + 1
    elseif c == "[" and line[i+1] == "[" then
      brackets = brackets + 1
    elseif c == "]" and line[i-1] == "]" then
      brackets = brackets - 1
    end
  end
  return single_quotes % 2 == 1 or double_quotes % 2 == 1 or brackets > 0
end

-- API code completion for Lua
-- Completes something.somethingelse APIs 
event.listen {
  name = "editor:complete",
  run = function(e)
    local parents = e.data.parentNodes
    local found_space_lua = false
    for _, parent in ipairs(parents) do
      if string.startswith(parent, "FencedCode:space-lua") then
        found_space_lua = true
      end
    end
    if not found_space_lua then
      return
    end
    local line_prefix = e.data.linePrefix
    if in_comment(line_prefix) or in_string(line_prefix) then
      return
    end
    local pos = e.data.pos
    local propaccess_prefix = string.match_regex(line_prefix, "([a-zA-Z_0-9]+\\.)*([a-zA-Z_0-9]*)$")
    if not propaccess_prefix or not propaccess_prefix[1] then
      -- No propaccess prefix, so we can't complete
      return
    end
    -- Split propaccess and traverse
    local prop_parts = string.split(propaccess_prefix[1], ".")
    local current_value = _CTX._GLOBAL
    local failed = false
    for i = 1, #prop_parts-1 do
      local prop = prop_parts[i]
      if current_value then
        current_value = current_value[prop]
      else
        failed = true
      end
    end
    if failed then
      return
    end
    local last_prop = prop_parts[#prop_parts]
    if table.includes(LUA_KEYWORDS, last_prop) then
      return
    end
    local options = {}
    for key, val in pairs(current_value) do
      if string.startswith(key, last_prop) and val then
        if val.call then
          -- We got a function
          if val.body then
            -- Function defined in Lua
            table.insert(options, {
              label = key .. "(" .. table.concat(val.body.parameters, ", ") ..")",
              apply = key .. "(",
              detail = "Lua function"
            })
          else
            -- Builtin
            table.insert(options, {
              label = key .. "()",
              apply = key .. "(",
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
        from = pos - string.len(last_prop),
        options = options
      }
    end
  end
}
```

# Slash templates
Various useful slash templates.

```space-lua
template.define_slash_command {
  name = "function",
  description = "Lua function",
  only_contexts = {"FencedCode:space-lua"},
  template = template.new [==[function |^|()
end]==]
}

template.define_slash_command {
  name = "tpl",
  description = "Lua template",
  only_contexts = {"FencedCode:space-lua"},
  template = template.new "template.new[==[|^|]==]"
}

template.define_slash_command {
  name = "lua-query",
  description = "Lua query",
  only_contexts = {"FencedCode:space-lua", "LuaDirective"},
  template = template.new 'query[[from index.tag "|^|"]]'
}


-- A query embedded in ${}
template.define_slash_command {
  name = "query",
  description = "Lua query",
  except_contexts = {"FencedCode:space-lua", "LuaDirective"},
  template = function() return '${query[[from index.tag "|^|"]]}' end
}
```
