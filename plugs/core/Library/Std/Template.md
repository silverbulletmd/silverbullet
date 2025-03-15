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

  return template.new(fm.text)
end

-- Creates a template-based slash command, keys for def are:
--   name: name of the slash command
--   description: description of the slash command
--   onlyContexts: parent AST nodes in which this slash command is available, defaults to everywhere
--   exceptContexts: parent AST nodes in which this slash command is not available
--   template: template function to apply
--   insertAt: position to insert the template into
--   match: match string to apply the template to
--   matchRegex: match regex to apply the template to
function template.defineSlashCommand(def)
  slashcommand.define {
    name = def.name,
    description = def.description,
    onlyContexts = def.onlyContexts,
    exceptContexts = def.exceptContexts,
    run = function()
      system.invokeFunction("template.applySnippetTemplate", def.template(), {
        insertAt = def.insertAt,
        match = def.match,
        matchRegex = def.matchRegex
      })
    end
  }
end
