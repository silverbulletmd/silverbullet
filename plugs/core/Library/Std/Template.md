#meta

Implements useful template functions

```space-lua
-- priority: 10
-- Template API root table
template = template or {}
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
function template.new(templateStr)
  -- Preprocess: strip indentation
  local lines = {}
  local splitLines = string.split(templateStr, "\n")
  for _, line in ipairs(splitLines) do
    line = string.gsub(line, "^    ", "")
    table.insert(lines, line)
  end
  templateStr = table.concat(lines, "\n")
  return function(obj)
    return spacelua.interpolate(templateStr, obj)
  end
end

function template.fromPage(name)
  local fm = index.extractFrontmatter(space.readPage(name),  {
    removeFrontmatterSection = true,
    removeTags = true
  })

  return template.new(string.trimStart(fm.text))
end
