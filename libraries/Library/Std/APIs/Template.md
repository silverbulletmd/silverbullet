---
description: APIs to create and render templates
tags: meta/api
---

APIs to create templates from strings or pages, and render query collections using templates.

# API

## template.new(templateStr, stripIndent)
Creates a template function from a string. The template string can contain `${expression}` placeholders that will be interpolated when the template is called. Conventionally, template strings typically use `[==[` and `]==]` as delimiters.

If `stripIndent` is `true` or omitted, leading 4-space indentation is stripped from each line.

Example:

```lua
-- the `templates` global table is available for custom templates
templates.greet = template.new [==[Hello ${name}!]==]
```

Which elsewhere can be used, either directly:

```lua
${templates.greet {name = "Pete"}}
```

or directly in a query’s `select` clause:

```lua
${query[[from p = index.contentPages() limit 3 select templates.greet(p)]]}
```

Resulting in something along the lines of `Hello index!Hello CONFIG!...`


## template.each(collection, fn)
Iterates over a collection and applies a template to each element, concatenating the results. While this API still works, but for queries the recommended approach is to call the template in the `select` clause directly (as shown above).

Example:

```lua
${query[[from p = index.contentPages() limit 3 select template.new[==[
    * [[${name}]]
]==](p)]]}
```

# Pre-built templates
The `templates` table contains ready-made templates for common query rendering patterns. These are defined in [[^Library/Std/Infrastructure/Query Templates]].

* **`templates.pageItem`** — renders a page as `* [[name]]`
* **`templates.fullPageItem`** — renders a page as `* [[name|name]]` (full path)
* **`templates.taskItem`** — renders a task as a togglable `* [state] [[ref]] name`
* **`templates.itemItem`** — renders an item as `* [[ref]] name`
* **`templates.paragraphItem`** — renders a paragraph as `* [[ref]] text`
* **`templates.tagItem`** — renders a tag as `* [[tag:name|#name]]`

# Implementation

```space-lua
-- priority: 50
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
  return #result > 0 and table.concat(result) or nil
end

-- Creates a new template function from a string template
function template.new(templateStr, stripIndent)
  -- Preprocess: strip indentation
  if stripIndent == nil or stripIndent == true then
    local lines = {}
    local splitLines = string.split(templateStr, "\n")
    for _, line in ipairs(splitLines) do
      line = string.gsub(line, "^    ", "")
      table.insert(lines, line)
    end
    templateStr = table.concat(lines, "\n")
  end
  return function(obj)
    return spacelua.interpolate(templateStr, obj)
  end
end

-- Reads a template from a page
-- Return value:
-- * The template itself
-- * The extracted frontmatter
function template.fromPage(name, raw)
  local fm = index.extractFrontmatter(space.readPage(name),  {
    removeFrontMatterSection = true,
    removeTagsPrefix = {"meta/template"}
  })

  local templateText = string.trimStart(fm.text)
  if raw then
    -- Don't actually parse this as a template, just pass it along
    return function()
      return templateText
    end, fm.frontmatter
  end
  return template.new(templateText, false), fm.frontmatter
end
```
