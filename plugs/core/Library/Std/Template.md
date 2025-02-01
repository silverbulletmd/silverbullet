#meta

Implements useful template functions

```space-lua
-- priority: 10
-- Template API root table
template = {}
-- Template storage table
templates = {}

-- Iterates over a table/array and applies a function to each element,
-- concatenating the results
function template.each(tbl, fn)
    local result = {}
    for _, item in ipairs(tbl) do
        table.insert(result, fn(item))
    end
    return table.concat(result)
end

-- Creates a new template function from a string template
function template.new(template_str)
  -- Preprocess: strip indentation
  local lines = {}
  local split_lines = string.split(template_str, "\n")
  for _, line in ipairs(split_lines) do
    line = string.gsub(line, "^    ", "")
    table.insert(lines, line)
  end
  template_str = table.concat(lines, "\n")
  return function(obj)
    return space_lua.interpolate(template_str, obj)
  end
end

-- Creates a template-based slash command, keys for def are:
--   name: name of the slash command
--   description: description of the slash command
--   only_contexts: parent AST nodes in which this slash command is available, defaults to everywhere
--   except_contexts: parent AST nodes in which this slash command is not available
--   template: template function to apply
--   insert_at: position to insert the template into
--   match: match string to apply the template to
--   match_regex: match regex to apply the template to
function template.define_slash_command(def)
  slash_command.define {
    name = def.name,
    description = def.description,
    onlyContexts = def.only_contexts,
    exceptContexts = def.except_contexts,
    run = function()
      system.invoke_function("template.applySnippetTemplate", def.template(), {
        insertAt = def.insert_at,
        match = def.match,
        matchRegex = def.match_regex
      })
    end
  }
end
```
