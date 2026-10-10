#meta/api

Implements convenience functions for accessing tag objects.

Currently:

* `tags.someTag` is an alias for `index.objects("someTag")`

Example:

${#query[[from tags.page]]}

## Frontmatter live previews

`tag.define` can provide `renderFrontmatter = function(pageMeta)` to render a page's YAML frontmatter as a custom widget in the editor. `pageMeta` contains the current, possibly unsaved frontmatter values and the page's name in `pageMeta.name`.

```lua
tag.define {
  name = "team",
  renderFrontmatter = function(pageMeta)
    return widget.htmlBlock(dom.div {
      class = "team-header",
      pageMeta.name .. " · " .. (pageMeta.status or "Unknown status"),
    })
  end,
}
```

When multiple frontmatter tags define a renderer, the first matching tag in the page's `tags` field wins. Without a matching renderer, frontmatter keeps its ordinary display and folding behavior. Pick Edit source from its ⋯ menu, Alt-click the preview, or click its noninteractive space to reveal the YAML and edit it directly. Go to definition in the same menu jumps to the `renderFrontmatter` function. The preview returns when the cursor leaves the frontmatter. Explicit Markdown syntax mode shows the source.

# Implementation

```space-lua
-- priority: 50
tag = tag or {}

function tag.define(spec)
  local finalSpec = config.get({"tags", spec.name}, {})
  local metatable = nil
  for k, v in pairs(spec) do
    if k == "metatable" then
      metatable = v
    else
      finalSpec[k] = v
    end
  end
  config.set({"tags", spec.name}, finalSpec)
  if metatable then
    config.setLuaValue({"tags", spec.name, "metatable"}, metatable)
  end
end

-- Set up tags.* short cut via meta tables
tags = setmetatable({}, {
  __index = function(self, tag)
    return index.objects(tag)
  end
})
```
