---
description: Renders an object's YAML (page frontmatter, data block documents) as an editable, schema-driven form.
tags: meta
---
Shows an object's YAML attributes as a form: a page's frontmatter, or each document of a data block (` ```#contact ` or ` ```data `). Each attribute gets an input chosen from its schema: the schema of the first of the object's tags that declares it, then the schema of its root tag (`page` for frontmatter, `data` for a data block).

The form knows nothing about pages or where the YAML is: it reads the render context and writes through `ctx.set`, `ctx.remove` and `ctx.move`.

# Field kinds
Every row has a kind that picks its input:

| kind | used for | input |
|---|---|---|
| `string` | text, and any string without a better match | wrapping text field; Shift+Enter for a new line |
| `number` | numbers | number field |
| `boolean` | `true` or `false` | checkbox |
| `date` | `schema.date()`, or a `YYYY-MM-DD` value, quoted or not (`2026-12-01`, `"2026-12-01"`); a date-time is a `string` | `YYYY-MM-DD` text field with a calendar button; written as a quoted string |
| `enum` | `schema.enum { ... }` | dropdown |
| `ref` | `schema.ref("person")`, or a value that is exactly one wikilink | chip with completion |
| `refs` | `schema.array(schema.ref("person"))`, or a list of wikilinks | chips with completion |
| `tags` | `schema.tags()`, such as `tags` | `#tag` chips completing from the space's tags |
| `identities` | `schema.identities()`, such as `recipients` and `authors` | `@name` chips completing from known identities |
| `strings` | a list of strings, or "list or string" schemas like `aliases` | one line per item |
| `unknown` | nested objects and other values the form can't edit | "(edit in source)" |

A schema with a custom `format` uses `widgets.inputFormats[format]` when one is registered (see [[Library/Std/Widgets/Inputs]]). It gets the input options plus `key`, `label`, `page`, `raw` (the value as written in the YAML) and `yamlType`.

When a present value doesn't match its schema (a plain `Bob` in a `ref` field, say), the row uses the input inferred from the value and shows the validation message as a warning. The value is never coerced. An attribute with no value and no schema (`due:`) is edited as a `string`.

# The form
Rows come in this order: `tags`, the other attributes in YAML order, the absent properties of the object's own tags (faint, sorted by key), then "+ add attribute". Edits are written as ordinary editor changes when committed (Enter, blur, a pick, a chip added or removed), so undo works as with typing.

* Each attribute in the YAML has a ⋯ menu (shown on hover or focus, always on touch screens; Shift+F10 or the context menu key opens it from the row's field): its type as a header line, **Move up** and **Move down** (reorders the keys in the YAML), **Change type…** for attributes without a schema, and **Delete**. Change type… converts the value in the YAML to another type.
* A value that doesn't fit its schema shows a warning with the validation message.
* Computed attributes (`created`, `lastModified` and so on for pages; `ref`, `tag`, `page` and so on for data) present in the YAML are shown read-only with a lock.
* "+ add attribute" offers the absent properties of the object's tags, the editable properties of its root tag (`page` or `data`), or a new name: type it and pick it (it's offered as the second option, marked "Add"), or press Shift-Enter; the form then asks for its type. The new row is written on its first value; left empty, it goes away.
* On an editable page without frontmatter, a faint tag icon ("add tag") left of the first line, shown while the mouse is over it, inserts `tags:` frontmatter, and the form opens on its (empty) `tags` row. A present `tags:` key always has its row, even when empty; removing the last tag leaves `tags:` (the same holds for any property with a `schema.tags()` schema).
* A page's `name` is its file name, so it isn't a row; in a data block, `name` is an ordinary attribute.
* Lists keep the shape they have in the YAML: a list stays a list, and a string stays a string with its separator (`tags: a b` or `tags: a, b`). A new `tags`, `recipients` or `authors` value is written as a space-separated string; a new list of strings as a YAML list.
* Undo and redo (Mod-z, Mod-Shift-z, Mod-y) work with focus in the form: each change is one undo step of the page; a text field with typing of its own undoes that first.
* On a read-only page, values show as plain text, and properties the schema declares but the YAML doesn't have are left out. Attributes in the YAML always show, even with an empty value (`due:`).

To render a tag's pages or data blocks differently, give the tag its own `renderFrontmatter` or `renderDataBlock`; it can still include the default form:

```lua
tag.define {
  name = "project",
  renderFrontmatter = function(pageMeta, ctx)
    return dom.div {
      dom.h3 { "Project" },
      objectForm.render(pageMeta, ctx)
    }
  end,
}
```

To turn the form off, use the `liveEdit.frontmatter` and `liveEdit.dataBlocks` settings ("Edit frontmatter as a form" and "Edit data blocks as a form" in the Configuration Manager). They only turn off this default form; a tag's own renderer still applies.

# API

## objectForm.render(object, ctx)
Returns the form as a widget. This is the `page` tag's `renderFrontmatter` and the `data` tag's `renderDataBlock`. Without `ctx`, it shows the object's values read-only.

## objectForm.pickRef(tagName, label)
Opens a picker over the pages carrying `#tagName` and the anchored objects carrying it (all pages and anchors without a tag). Returns the picked link (`"[[Page]]"` or `"[[$name]]"`), or `nil`.

## objectForm.infer(value, yamlType)
Returns a schema for a value without one. `yamlType` is the value's YAML type (`"string"`, `"number"`, `"boolean"`, `"date"`, `"null"`, `"array"` or `"object"`).

## objectForm.fieldKind(schema)
Returns the field kind of a property schema (see above); the kind of input `widgets.schemaInput` picks.

## objectForm.typeName(kind)
Returns the type name shown in the type menu: `string`, `number`, `boolean`, `date`, `ref`, `string[]`, `ref[]`, `tag[]` or `identity[]`. Other kinds are returned as is.

## objectForm.convert(value, typeName)
Converts a value to the given type name. Returns the new value, or `nil` and a reason when the conversion can't work (`"abc"` to `number`). A `date` is returned as its `YYYY-MM-DD` string.

## objectForm.resolveField(key, object, ctx, tags)
Returns `{ schema, kind, fromSchema, declared, warning }` for one attribute. `declared` is the property's schema as the tag declares it (before unwrapping `schema.nullable`), or `nil`. `tags` defaults to `objectForm.ownTags(object, ctx.kind)`.

## objectForm.ownTags(object, kind)
Returns the tags whose schemas apply before the root tag `kind`: a data object's own root tag (`contact` for ` ```#contact `), then its `tags`.

## objectForm.rows(object, ctx)
Returns the form's rows in display order: `tags`, the other present keys in YAML order, then the absent properties of the object's own tags, sorted by key (none when `ctx.readOnly` is true). Each row has `key`, `value`, `raw`, `yamlType`, `schema`, `kind`, `fromSchema`, and optionally `declared`, `warning` and `locked` (a computed, read-only attribute present in the YAML).

## Internal helpers
`objectForm.typeOptions`, `customNameProblem`, `attributeSuggestions`, `pickedAttribute`, `listItems`, `listValue`, `rowMenuItems` and `write` are exposed only so they can be tested. They are internal and may change without notice; don't build on them.

# Implementation

```space-lua
-- priority: 30
objectForm = objectForm or {}

local isWikilink = widgets.inputCompletion.isWikilink
local unwrap = widgets.inputSchema.unwrap

local function isList(v, yamlType)
  if type(v) ~= "table" then return false end
  if yamlType then return yamlType == "array" end
  return v[1] ~= nil or next(v) == nil
end

local function isIsoDate(value)
  return type(value) == "string" and widgets.inputDate.isoDateProblem(value) == nil
end

function objectForm.infer(value, yamlType)
  -- An empty value (`due:`) is most likely waiting for text
  if value == nil or yamlType == "null" then return schema.string() end
  local t = type(value)
  if t == "number" then return schema.number() end
  if t == "boolean" then return schema.boolean() end
  if t == "string" then
    -- Quoted or bare, an ISO date is a date; a date-time is text
    if isIsoDate(value) then return schema.date() end
    if isWikilink(value) then return schema.ref() end
    return schema.string()
  end
  if isList(value, yamlType) then
    local allLinks, allStrings = true, true
    for _, item in ipairs(value) do
      if type(item) ~= "string" then allStrings = false end
      if not isWikilink(item) then allLinks = false end
    end
    if #value > 0 and allLinks then return schema.array(schema.ref()) end
    if allStrings then return schema.array("string") end
  end
  return {}
end

function objectForm.fieldKind(s)
  return widgets.inputSchema.kindOf(s)
end

local typeNames = { strings = "string[]", refs = "ref[]", tags = "tag[]", identities = "identity[]" }

function objectForm.typeName(kind)
  return typeNames[kind] or kind
end

local function toScalar(value, typeName)
  if value == nil then value = "" end
  if type(value) == "table" then
    if #value ~= 1 then return nil, "not a single value" end
    value = value[1]
  end
  if typeName == "string" then
    if isWikilink(value) then return value:sub(3, -3) end
    return tostring(value)
  elseif typeName == "ref" then
    if isWikilink(value) then return value end
    local s = tostring(value)
    if s == "" then return nil, "empty" end
    if s:find("[", 1, true) or s:find("]", 1, true) then
      return nil, "contains brackets"
    end
    return "[[" .. s .. "]]"
  elseif typeName == "number" then
    if type(value) == "number" then return value end
    local n = type(value) == "string" and tonumber(value) or nil
    if n == nil then return nil, "not a number" end
    return n
  elseif typeName == "boolean" then
    if type(value) == "boolean" then return value end
    if value == "true" then return true end
    if value == "false" then return false end
    return nil, "not true or false"
  elseif typeName == "date" then
    if type(value) == "userdata" and value.toISOString then
      value = value.toISOString():sub(1, 10)
    end
    if isIsoDate(value) then return value end
    return nil, "not a YYYY-MM-DD date"
  end
  return nil, "unknown type " .. tostring(typeName)
end

function objectForm.convert(value, typeName)
  local itemType = typeName == "string[]" and "string"
    or typeName == "ref[]" and "ref"
  if not itemType then return toScalar(value, typeName) end
  local items = type(value) == "table" and value or { value }
  if value == nil then items = {} end
  local out = {}
  for _, item in ipairs(items) do
    local converted, reason = toScalar(item, itemType)
    if converted == nil then return nil, reason end
    table.insert(out, converted)
  end
  return out
end

-- The root tag of the object's kind: `page` for frontmatter, `data` for a
-- data block
local function rootOf(ctx)
  return (ctx and ctx.kind) or "page"
end

-- The tags whose schemas apply, before the root tag: a data object's own
-- root tag (```#contact), then the object's tags
function objectForm.ownTags(object, kind)
  kind = kind or "page"
  local tags = {}
  if object.tag and object.tag ~= kind then table.insert(tags, object.tag) end
  for _, t in ipairs(object.tags or {}) do
    if t ~= kind and t ~= object.tag then table.insert(tags, t) end
  end
  return tags
end

local function schemaFor(key, tags, root)
  for _, t in ipairs(tags) do
    local s = config.get({ "tags", t, "schema", "properties", key })
    if s then return s end
  end
  return config.get({ "tags", root, "schema", "properties", key })
end

function objectForm.resolveField(key, object, ctx, tags)
  local root = rootOf(ctx)
  tags = tags or objectForm.ownTags(object, root)
  local raw = ctx.values and ctx.values[key]
  local yamlType = ctx.types and ctx.types[key]
  local s = schemaFor(key, tags, root)
  local warning
  if s and raw ~= nil then
    warning = jsonschema.validateObject(s, raw)
  end
  if s and not warning then
    local resolved = unwrap(s)
    return {
      schema = resolved,
      kind = objectForm.fieldKind(resolved),
      fromSchema = true,
      declared = s,
    }
  end
  -- A declared property keeps fromSchema even when its value doesn't fit, so
  -- the form offers no type menu; the warning points at the source instead
  local inferred = objectForm.infer(raw, yamlType)
  return {
    schema = inferred,
    kind = objectForm.fieldKind(inferred),
    fromSchema = s ~= nil,
    declared = s,
    warning = warning,
  }
end

function objectForm.rows(object, ctx)
  local root = rootOf(ctx)
  local tags = objectForm.ownTags(object, root)
  local present = {}
  for _, key in ipairs(ctx.keys or {}) do present[key] = true end
  local rows = {}
  -- A page's name is its file name; a data object's is an ordinary key
  local seen = { name = root == "page" }

  local function add(key)
    seen[key] = true
    local field = objectForm.resolveField(key, object, ctx, tags)
    -- The declared schema decides, so a computed key with an odd value stays locked
    if unwrap(field.declared or {}).readOnly then
      if not present[key] then return end
      field.locked = true
    end
    field.key = key
    field.raw = ctx.values and ctx.values[key]
    field.yamlType = ctx.types and ctx.types[key]
    if present[key] then
      field.value = object[key]
      if field.value == nil then field.value = field.raw end
    end
    table.insert(rows, field)
  end

  -- tags first when the YAML has it, even empty (`tags:`); never as an
  -- absent property
  seen.tags = true
  if present.tags then add("tags") end
  for _, key in ipairs(ctx.keys or {}) do
    if not seen[key] then add(key) end
  end

  -- Nothing to fill in, so a read-only form has no rows for absent properties
  if ctx.readOnly then return rows end

  local missing, listed = {}, {}
  for _, t in ipairs(tags) do
    local props = config.get({ "tags", t, "schema", "properties" }) or {}
    for key in pairs(props) do
      if not seen[key] and not listed[key] then
        listed[key] = true
        table.insert(missing, key)
      end
    end
  end
  table.sort(missing)
  for _, key in ipairs(missing) do add(key) end
  return rows
end

-- Values and helpers

local typeList = { "string", "number", "boolean", "date", "ref", "string[]", "ref[]" }
local kindOfType = { ["string[]"] = "strings", ["ref[]"] = "refs" }

-- The items of a list value as written: a list as is; a string split on
-- commas, and for tags and @names also on spaces (a wikilink stays whole)
function objectForm.listItems(raw, kind)
  local items = {}
  if type(raw) == "table" then
    for _, v in ipairs(raw) do table.insert(items, tostring(v)) end
    return items
  end
  if raw == nil then return items end
  local text = tostring(raw)
  if kind == "strings" then
    for part in text:gmatch("[^,]+") do
      local trimmed = part:match("^%s*(.-)%s*$")
      if trimmed ~= "" then table.insert(items, trimmed) end
    end
    return items
  end
  local pos = 1
  while pos <= #text do
    local _, sepEnd = text:find("^[,%s]+", pos)
    if sepEnd then pos = sepEnd + 1 end
    if pos > #text then break end
    local _, linkEnd = text:find("^%[%[.-%]%]", pos)
    local _, wordEnd = text:find("^[^,%s]+", pos)
    local stop = (kind == "identities" and linkEnd) or wordEnd
    table.insert(items, text:sub(pos, stop))
    pos = stop + 1
  end
  return items
end

-- A list value in the shape of the value it replaces: a list stays a list, a
-- string stays a string with its separator. A new tags or @names value is a
-- space-separated string, a new string list a list
function objectForm.listValue(items, raw, kind)
  if #items == 0 then return nil end
  if type(raw) == "table" then
    local out = {}
    for i, v in ipairs(items) do out[i] = v end
    return out
  end
  if kind == "strings" then
    if type(raw) == "string" then return table.concat(items, ", ") end
    local out = {}
    for i, v in ipairs(items) do out[i] = v end
    return out
  end
  local comma = type(raw) == "string" and raw:find(",", 1, true)
  return table.concat(items, comma and ", " or " ")
end

function objectForm.pickRef(tagName, label)
  local picked = editor.filterBox(label, widgets.inputCompletion.refCandidates(tagName),
    tagName and ("Pages and anchors tagged #" .. tagName) or "Pages and anchors")
  return picked and picked.link
end

local dateStringReason =
  "ISO dates are detected automatically — declare schema.string() to keep it as text"

function objectForm.typeOptions(value, kind)
  local current = objectForm.typeName(kind)
  local options = {}
  for i, name in ipairs(typeList) do
    local option = { name = name, orderId = i }
    if name == current then
      option.description = "current type"
      option.current = true
    elseif kind == "date" and name == "string" then
      -- Converting would write the same text, which reads as a date again
      option.reason = dateStringReason
      option.description = dateStringReason
    else
      local converted, reason = objectForm.convert(value, name)
      if converted == nil then
        option.description = "can't convert: " .. tostring(reason)
        option.reason = reason
      end
    end
    table.insert(options, option)
  end
  table.insert(options, {
    name = "remove",
    orderId = #typeList + 1,
    description = "Delete this attribute",
    remove = true,
  })
  return options
end

local function typeDescription(kind, s)
  local name = objectForm.typeName(kind)
  local target = s and (s.tag or (s.items and unwrap(s.items).tag))
  if (kind == "ref" or kind == "refs") and target then
    return name .. " → #" .. target
  end
  return name
end

-- Why a typed custom attribute name can't be added, or nil
function objectForm.customNameProblem(key, shown, kind)
  kind = kind or "page"
  if kind == "page" and key == "name" then
    return "name is the page name, it can't be set"
  end
  if shown[key] then return key .. " already exists" end
  local s = config.get({ "tags", kind, "schema", "properties", key })
  if s and unwrap(s).readOnly then
    return key .. " is computed by the index, it can't be set"
  end
  return nil
end

-- Suggestions for "+ add attribute": absent properties of the object's own
-- tags, then editable properties of its root tag
function objectForm.attributeSuggestions(object, shown, kind)
  kind = kind or "page"
  local options, listed = {}, {}
  local order = 0
  local function offer(key, s, hint)
    s = unwrap(s or {})
    if shown[key] or listed[key] or s.readOnly then return end
    if kind == "page" and key == "name" then return end
    local fieldKind = objectForm.fieldKind(s)
    if fieldKind == "unknown" then return end
    listed[key] = true
    order = order + 1
    table.insert(options, {
      name = key,
      description = typeDescription(fieldKind, s),
      hint = hint,
      orderId = order,
      key = key,
    })
  end
  local function offerAll(t, hint)
    local props = config.get({ "tags", t, "schema", "properties" }) or {}
    local keys = {}
    for key in pairs(props) do table.insert(keys, key) end
    table.sort(keys)
    for _, key in ipairs(keys) do offer(key, props[key], hint) end
  end
  for _, t in ipairs(objectForm.ownTags(object, kind)) do
    offerAll(t, "#" .. t)
  end
  offerAll(kind, kind)
  return options
end

-- The key an "+ add attribute" pick adds: a suggestion's own key, or a typed
-- new name (custom = true), or nil and why that name can't be added
function objectForm.pickedAttribute(picked, shown, kind)
  if picked.key and not picked.isNew then return { key = picked.key } end
  local key = tostring(picked.name or ""):match("^%s*(.-)%s*$")
  if key == "" then return nil end
  local problem = objectForm.customNameProblem(key, shown, kind)
  if problem then return nil, problem end
  return { key = key, custom = true }
end

-- Editors

local icons = {
  lock = '<svg class="sb-fm-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
  warning = '<svg class="sb-fm-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
}


local function refTag(s)
  if s.items then return unwrap(s.items).tag end
  return s.tag
end

local listKinds = { strings = true, tags = true, identities = true }

-- The row's input widget; list kinds map between the YAML shape and a list
local function editorNode(row, field)
  local kind = row.kind
  if kind == "unknown" then
    return dom.span { class = "sb-fm-complex", dom.text("(edit in source)") }
  end
  local opts = {
    key = field.key,
    label = field.label,
    page = field.page,
    raw = field.raw,
    yamlType = field.yamlType,
    readOnly = field.readOnly,
    value = field.value,
    onChange = field.set,
  }
  if listKinds[kind] then
    opts.value = objectForm.listItems(row.raw, kind)
    opts.onChange = function(list)
      -- row.raw follows each write, so the shape is the one last written
      field.set(objectForm.listValue(list or {}, row.raw, kind))
    end
  end
  return widgets.schemaInput(field.schema, opts)
end

-- The form

-- The renderer's ctx knows where the object is written; the form doesn't
-- With keepEmpty, "" is written as is and nil empties the value (`key:`)
function objectForm.write(ctx, key, value, keepEmpty)
  local ok, err
  if not keepEmpty and (value == nil or value == "") then
    ok, err = pcall(ctx.remove, key)
  else
    ok, err = pcall(ctx.set, key, value)
  end
  if not ok then editor.flashNotification(tostring(err), "error") end
  return ok
end

local write = objectForm.write

local function displayValue(v)
  if type(v) == "table" then
    local parts = {}
    for _, item in ipairs(v) do table.insert(parts, tostring(item)) end
    return table.concat(parts, ", ")
  end
  return v ~= nil and tostring(v) or ""
end

-- Moves a key `delta` places in the YAML through the renderer's ctx
local function moveKey(ctx, key, delta)
  if not delta or delta == 0 then return end
  if not ctx.move then
    return editor.flashNotification("This form can't reorder attributes", "error")
  end
  local ok, err = pcall(ctx.move, key, delta)
  if not ok then editor.flashNotification(tostring(err), "error") end
end

local function changeType(ctx, row)
  local picked = editor.filterBox("Type of " .. row.key,
    objectForm.typeOptions(row.raw, row.kind),
    "Converts the value in the YAML")
  if not picked or picked.current then return end
  if picked.remove then return write(ctx, row.key, nil) end
  if picked.reason then
    return editor.flashNotification(picked.reason, "error")
  end
  local converted, reason = objectForm.convert(row.raw, picked.name)
  if converted == nil then
    return editor.flashNotification(reason, "error")
  end
  write(ctx, row.key, converted, true)
end

-- The row's ⋯ menu, without its actions: a type header, moves, Change
-- type… and Delete. `info` has the row's `position` among the rows that can
-- move (nil when it can't), their `count`, and `pending` for an unwritten row
function objectForm.rowMenuItems(row, info)
  local items = {}
  if row.kind and row.kind ~= "unknown" then
    table.insert(items, { header = typeDescription(row.kind, row.schema) })
  end
  local cantMove
  if info.pending then
    cantMove = "Give it a value first"
  elseif row.key == "tags" then
    cantMove = "tags is always shown first"
  elseif not info.position then
    cantMove = "Only attributes in the YAML can move"
  end
  local function move(label, action, atEnd, endReason)
    local reason = cantMove or (atEnd and endReason) or nil
    table.insert(items, {
      label = label,
      action = action,
      disabled = reason ~= nil,
      reason = reason,
    })
  end
  move("Move up", "up", info.position == 1, "Already first")
  move("Move down", "down", info.position == info.count, "Already last")
  if not row.fromSchema and not row.locked and not info.pending then
    table.insert(items, { label = "Change type…", action = "type" })
  end
  table.insert(items, { separator = true })
  local cantDelete = row.locked and "Computed by the index; edit in source" or nil
  table.insert(items, {
    label = "Delete",
    action = "delete",
    danger = true,
    disabled = cantDelete ~= nil,
    reason = cantDelete,
  })
  return items
end

-- Lets the form re-render after a menu action: it keeps its DOM while focused
local function blurWithin(node)
  local active = js.window.document.activeElement
  if active and node.contains(active) then active.blur() end
end

local function rowNode(row, ctx, page, opts)
  local readOnly = opts.readOnly
  local s = row.schema or {}
  local label = s.title or row.key
  local field = {
    key = row.key,
    label = label,
    value = row.value,
    raw = row.raw,
    yamlType = row.yamlType,
    schema = s,
    page = page,
    readOnly = readOnly,
    set = function(v)
      if opts.onSet then opts.onSet(v) end
      -- An emptied tags row keeps its key, ready for the next tag
      if not write(ctx, row.key, v, v == nil and row.kind == "tags") then return end
      -- The type menu converts from this, not from the rendered value
      if type(v) == "userdata" and v.toISOString then
        row.raw = v.toISOString():sub(1, 10)
      else
        row.raw = v
      end
    end,
  }
  local value
  if row.locked then
    value = dom.span {
      class = "sb-fm-locked",
      title = "Computed by the index; edit in source",
      widget.html(icons.lock),
      dom.text(displayValue(row.value)),
    }
  else
    value = editorNode(row, field)
  end
  local warning = row.warning and dom.span {
    class = "sb-fm-warning",
    title = row.warning,
    widget.html(icons.warning),
  }
  local node
  local actions = {
    up = function() moveKey(ctx, row.key, opts.upDelta) end,
    down = function() moveKey(ctx, row.key, opts.downDelta) end,
    type = function() changeType(ctx, row) end,
    delete = function()
      if opts.pending then return node.remove() end
      write(ctx, row.key, nil)
    end,
  }
  local menu = (opts.present or opts.pending) and not readOnly and widgets.menu {
    title = "Attribute actions",
    items = function()
      local items = objectForm.rowMenuItems(row, {
        position = opts.position,
        count = opts.count,
        pending = opts.pending,
      })
      for _, item in ipairs(items) do
        if item.action then
          item.onSelect = function()
            blurWithin(node)
            actions[item.action]()
          end
        end
      end
      return items
    end,
  }
  node = dom.div {
    class = {
      "sb-fm-row",
      "sb-in-menu-owner",
      not opts.present and not opts.pending and "sb-fm-missing",
      opts.pending == true and "sb-fm-pending",
    },
    ["data-key"] = row.key,
    -- Shift+F10 or the context menu key opens the row's menu from a field
    onkeydown = menu and function(e)
      if e.key == "ContextMenu" or (e.key == "F10" and e.shiftKey) then
        if menu.contains(e.target) then return end
        e.preventDefault()
        widgets.openMenu(menu)
      end
    end or nil,
    dom.div { class = "sb-fm-key", title = s.description, dom.text(label) },
    dom.div { class = "sb-fm-value", value },
    dom.div { class = "sb-fm-aside", warning, menu },
  }
  return node
end

local function hasInputValue(node)
  local fields = node.querySelectorAll("input, select, textarea")
  for i = 0, fields.length - 1 do
    local input = fields.item(i)
    if input.type ~= "checkbox" and input.value ~= "" then return true end
  end
  return false
end

-- Without a ctx there is nowhere to write, so the form only shows values
local function fallbackContext(object)
  local keys = {}
  for key in pairs(object) do
    if key ~= "name" then table.insert(keys, key) end
  end
  table.sort(keys)
  return { kind = "page", values = object, types = {}, keys = keys, readOnly = true }
end

--- Renders an object's YAML attributes as an editable, schema-driven form.
--- @param object table the object's values (a page's frontmatter plus name, or a data object)
--- @param ctx? table the render context { kind: "page"|"data", values: table, types: table, keys: table, readOnly: boolean, set: function(key, value), remove: function(key), move: function(key, delta), addItem?: function() }; without it the form is read-only
--- @return table a block widget
--- @see Live Edit
function objectForm.render(object, ctx)
  ctx = ctx or fallbackContext(object)
  local kind = rootOf(ctx)
  local page = object.page or object.name
  local readOnly = ctx.readOnly == true
  local present, shown = {}, {}
  for _, key in ipairs(ctx.keys or {}) do present[key] = true end

  local rows = objectForm.rows(object, ctx)
  -- Rows that move: present ones in YAML order, but not tags (always first);
  -- a move steps over keys that aren't shown in between
  local yamlIndex, movable = {}, {}
  for i, key in ipairs(ctx.keys or {}) do yamlIndex[key] = i end
  for _, row in ipairs(rows) do
    if present[row.key] and row.key ~= "tags" then table.insert(movable, row.key) end
  end
  local position = {}
  for i, key in ipairs(movable) do position[key] = i end

  local nodes = {}
  for _, row in ipairs(rows) do
    if present[row.key] then shown[row.key] = true end
    local p = position[row.key]
    local function delta(other)
      return other and (yamlIndex[other] - yamlIndex[row.key]) or nil
    end
    table.insert(nodes, rowNode(row, ctx, page, {
      readOnly = readOnly,
      present = present[row.key],
      position = p,
      count = #movable,
      upDelta = p and delta(movable[p - 1]),
      downDelta = p and delta(movable[p + 1]),
    }))
  end

  local form, addLine

  -- Nothing is written until the row's first value; left empty, it goes away
  local function addPending(row)
    local committed = false
    local node = rowNode(row, ctx, page, {
      pending = true,
      present = false,
      onSet = function(v) if v ~= nil and v ~= "" then committed = true end end,
    })
    -- An empty slot for the same key moves to the end as this row
    local children = form.children
    for i = children.length - 1, 0, -1 do
      local child = children.item(i)
      if child.getAttribute("data-key") == row.key then child.remove() end
    end
    node.addEventListener("focusout", function(e)
      if e.relatedTarget and node.contains(e.relatedTarget) then return end
      if not committed and not hasInputValue(node) then node.remove() end
    end)
    form.insertBefore(node, addLine)
    local input = node.querySelector("input, select, textarea")
    if input then input.focus() end
  end

  local function pickAttribute()
    local picked = editor.filterBox("add attribute",
      objectForm.attributeSuggestions(object, shown, kind),
      "Pick a property, or type a new name", "",
      { allowNew = true, newHint = "Add" })
    if not picked then return end
    local added, problem = objectForm.pickedAttribute(picked, shown, kind)
    if problem then return editor.flashNotification(problem, "error") end
    if not added then return end
    local key = added.key
    local row = objectForm.resolveField(key, object, { kind = kind, values = {}, types = {} })
    if added.custom and not row.fromSchema then
      local typeOptions = {}
      for i, name in ipairs(typeList) do
        table.insert(typeOptions, { name = name, orderId = i })
      end
      local t = editor.filterBox("Type of " .. key, typeOptions)
      if not t then return end
      local kind = kindOfType[t.name] or t.name
      row.kind = kind
      row.schema = ({
        string = schema.string(),
        number = schema.number(),
        boolean = schema.boolean(),
        date = schema.date(),
        ref = schema.ref(),
        strings = schema.array("string"),
        refs = schema.array(schema.ref()),
      })[kind]
    end
    row.key = key
    if row.kind == "ref" or row.kind == "refs" then
      local link = objectForm.pickRef(refTag(row.schema), row.schema.title or key)
      if link then write(ctx, key, row.kind == "refs" and { link } or link) end
      return
    end
    -- false is a complete value, so a checkbox needs no pending state
    if row.kind == "boolean" then return write(ctx, key, false) end
    addPending(row)
  end

  -- The pickers take focus, and the host rebuilds a form focus has left
  -- when it is out of date (after an edit committed with Enter); the pending
  -- row would then go into the old, detached form. data-sb-keep asks the host
  -- to keep this DOM until the row is in place and focused
  local function addAttribute()
    form.setAttribute("data-sb-keep", "")
    local ok, err = pcall(pickAttribute)
    form.removeAttribute("data-sb-keep")
    if not ok then error(err) end
  end

  local function addItem()
    local ok, err = pcall(ctx.addItem)
    if not ok then editor.flashNotification(tostring(err), "error") end
  end

  addLine = dom.div {
    class = "sb-fm-add-row",
    not readOnly and dom.button {
      class = "sb-fm-add-attr",
      onclick = addAttribute,
      dom.text("+ add attribute"),
    },
    -- Only the last item of a data block has addItem; keep it last here
    not readOnly and ctx.addItem and dom.button {
      class = "sb-fm-add-attr sb-fm-add-item",
      onclick = addItem,
      dom.text("+ add item"),
    },
  }
  form = dom.div { class = "sb-fm-form", nodes, addLine }
  return widget.htmlBlock(form)
end

tag.define { name = "page", renderFrontmatter = objectForm.render }
tag.define { name = "data", renderDataBlock = objectForm.render }
```

## Styling
```space-style
.sb-fm-form {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr) auto;
  column-gap: 12px;
  padding: 4px 10px;
  border: 1px solid var(--ui-surface-border-color);
  border-radius: 6px;
  font-size: 0.9em;
  line-height: 1.4;
}
.sb-fm-row { display: contents; }
.sb-fm-key {
  align-self: start;
  padding: 4px 0;
  color: var(--subtle-color);
  font-weight: 600;
  overflow-wrap: anywhere;
  cursor: text;
}
.sb-fm-missing .sb-fm-key { opacity: 0.55; }
.sb-fm-value {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 28px;
}
.sb-fm-value > .sb-in-text,
.sb-fm-value > .sb-in-linkfield,
.sb-fm-value > .sb-in-chips,
.sb-fm-value > .sb-in-list,
.sb-fm-value > .sb-in-plain { flex: 1 1 auto; }
.sb-fm-aside {
  display: flex;
  align-items: start;
  justify-content: flex-end;
  gap: 4px;
  padding-top: 4px;
}
.sb-fm-add-attr {
  padding: 0;
  border: none;
  background: none;
  color: var(--subtle-color);
  font: inherit;
  cursor: pointer;
}
.sb-fm-add-attr:hover { color: var(--root-color); }
.sb-fm-add-item { margin-left: 16px; }
/* The same background as the YAML it replaces */
.sb-frontmatter-preview .sb-fm-form { background-color: var(--editor-frontmatter-background-color); }
.sb-data-block-preview .sb-fm-form { background-color: var(--editor-code-background-color); }
.sb-fm-add-row { grid-column: 1 / -1; padding: 2px 0 4px; }
.sb-fm-warning { display: inline-flex; color: var(--alert-warning-color); cursor: help; }
.sb-fm-locked {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 2px 6px;
  color: var(--subtle-color);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sb-fm-locked .sb-fm-icon { flex-shrink: 0; align-self: center; }
.sb-fm-complex { padding: 2px 6px; color: var(--subtle-color); font-style: italic; }
.sb-fm-icon { display: block; }
/* Too narrow for three columns: each key goes above its full-width value,
   with its warning and menu at the end of the key's line */
@media (max-width: 600px) {
  .sb-fm-form { grid-template-columns: minmax(0, 1fr) auto; grid-auto-flow: row dense; }
  .sb-fm-key { grid-column: 1; padding: 6px 0 0; }
  .sb-fm-aside { grid-column: 2; padding-top: 6px; }
  .sb-fm-value { grid-column: 1 / -1; }
}
```
