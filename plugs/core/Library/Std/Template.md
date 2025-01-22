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
```
