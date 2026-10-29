---
description: Define tags (schema, validation, indexing, rendering) and query their objects
tags: meta/api
---

Functions for defining tags and accessing their objects. See [API/tag](https://silverbullet.md/API/tag) for use cases and longer examples.

# API

## tag.define(spec)
Defines a tag, or extends an existing definition. Put `tag.define` calls in your [[CONFIG]] page so they are in place when the index runs.

`spec` is a table with these fields, all optional except `name`:
* `name` (string): the tag's name, without `#`.
* `tagPage` (string): the page to open when clicking the tag. Defaults to `tag:<name>`.
* `schema` (table): a [JSON Schema](https://silverbullet.md/Schema) the tag's objects are validated against. Build it with the [[^Library/Std/APIs/Schema|schema]] helpers. Validation failures show as lint warnings in the editor.
* `mustValidate` (boolean): when `true`, objects that fail `schema` or `validate` are not indexed. Defaults to `false`.
* `validate` (function `function(object)`): custom validation; returns `nil` when valid, or an error message.
* `transform` (function `function(object)`): called for each indexed object with this tag. Change the object and return it, return `{}` to skip indexing it, return `nil` to index it unchanged, or return a list of objects to index instead (one of which must keep the original `ref`).
* `metatable` (table): a Lua metatable set on the tag's objects, e.g. to add computed attributes via `__index`.
* `renderFrontmatter` (function `function(pageMeta, ctx)`): renders the frontmatter of pages with this tag as a widget. See [[#Rendering objects]].
* `renderDataBlock` (function `function(object, ctx)`): renders each object of a ` ```#name ` data block as a widget. See [[#Rendering objects]].

Calling `tag.define` again with the same `name` merges the new fields into the existing definition, so you can extend built-in tags. Set a field to `config.unset` to remove it.

Example:

```lua
tag.define {
  name = "person",
  schema = {
    type = "object",
    properties = {
      email = schema.string(),
      manager = schema.ref("person"),
    },
  },
  transform = function(o)
    o.pageDecoration = { icon = "user" }
    return o
  end,
}
```

### Rendering objects
`tag.define` can render a tag's objects as a custom widget in the editor, in place of their YAML. Each kind of object has its own hook:
* `renderFrontmatter = function(pageMeta, ctx)` for a page's frontmatter
* `renderDataBlock = function(object, ctx)` for each document of a ` ```#name ` data block.

By default both render [[^Library/Std/Widgets/Object Form]].

The first argument is the object with its current, possibly unsaved values: a page's frontmatter plus its name in `pageMeta.name`, or a data object's YAML plus `ref`, `tag`, `tags` and `page`. `ctx` is the render context: the raw YAML (`ctx.values`, `ctx.types`, `ctx.keys`), `ctx.kind` (`"page"` or `"data"`), `ctx.readOnly`, and `ctx.set(key, value)`, `ctx.remove(key)` and `ctx.move(key, delta)` to change it. See [Live Edit](https://silverbullet.md/Live%20Edit#The%20render%20context) for what each field holds, how errors and undo work, and an example.

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

For frontmatter, the first tag in the page's `tags` field with a `renderFrontmatter` wins, and pages without one fall back to the renderer of the `page` tag. For a ` ```#name ` block, the first match wins: the `name` tag's `renderDataBlock`, a code widget for `#name` (see [[^Library/Std/APIs/Code Widget]]), the `data` tag's `renderDataBlock`, then plain YAML. A block with several YAML documents (separated by `---`) shows one widget per document. Without any renderer, the YAML shows as plain text. The `liveEdit.frontmatter` and `liveEdit.dataBlocks` settings turn off the default form (the `page` and `data` renderers) without affecting a tag's own renderer.

## tags.<name>
Shortcut for `index.objects("<name>")`: all indexed objects with that tag.

# Implementation

```space-lua
-- priority: 50
tag = tag or {}

--- Defines a tag, or merges `spec` into an existing definition with the same name.
--- @param spec table { name: string, tagPage?: string, schema?: table, mustValidate?: boolean, validate?: function(object), transform?: function(object), metatable?: table, renderFrontmatter?: function(pageMeta, ctx), renderDataBlock?: function(object, ctx) }; set a field to config.unset to remove it
--- @see API/tag
function tag.define(spec)
  local fields = {}
  local metatable = nil
  for k, v in pairs(spec) do
    if k == "metatable" and v ~= config.unset then
      metatable = v
    else
      fields[k] = v
    end
  end
  config.merge({"tags", spec.name}, fields)
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
