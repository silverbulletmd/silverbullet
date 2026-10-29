---
description: Schema normalization and dispatch to the public input widgets.
tags: meta
---
Schema normalization and dispatch to the public input widgets. Internal implementation of [[Library/Std/Widgets/Inputs]].

```space-lua
-- priority: 50
widgets = widgets or {}
widgets.inputFormats = widgets.inputFormats or {}
-- The non-null branch of a nullable `anyOf`, keeping the outer annotations
local function unwrap(s)
  if type(s) ~= "table" or not s.anyOf then return s end
  local branches = {}
  for _, branch in ipairs(s.anyOf) do
    if branch.type ~= "null" then table.insert(branches, branch) end
  end
  if #branches ~= 1 then return s end
  local result = {}
  for k, v in pairs(unwrap(branches[1])) do result[k] = v end
  for _, k in ipairs({ "title", "description", "readOnly" }) do
    if result[k] == nil then result[k] = s[k] end
  end
  return result
end


-- Formats with a built-in kind, even without a registered widget
local builtinFormats = { ref = true, date = true }
local itemFormatKinds = { tag = "tags", identity = "identities" }
local stringFormatKinds = { tags = "tags", identities = "identities" }

-- "tags" or "identities" for a list of tag/identity items or a tags/identities string
local function nameListKind(s)
  if s.type == "array" and s.items then
    return itemFormatKinds[unwrap(s.items).format]
  end
  if s.type == "string" then return stringFormatKinds[s.format] end
  return nil
end

local function isStringOrStrings(s)
  s = unwrap(s)
  if s.type == "string" and not s.format and not s.enum then return true end
  return s.type == "array" and s.items ~= nil and unwrap(s.items).type == "string"
end

local function kindOf(s)
  s = unwrap(s or {})
  if s.anyOf then
    local listKind, plain = nil, true
    for _, branch in ipairs(s.anyOf) do
      if branch.type ~= "null" then
        local kind = nameListKind(unwrap(branch))
        if kind == nil or (listKind ~= nil and listKind ~= kind) then
          listKind = false
        elseif listKind ~= false then
          listKind = kind
        end
        if not isStringOrStrings(branch) then plain = false end
      end
    end
    if listKind then return listKind end
    if listKind == nil then return "unknown" end
    return plain and "strings" or "unknown"
  end
  local listKind = nameListKind(s)
  if listKind then return listKind end
  if s.format and (widgets.inputFormats[s.format] or builtinFormats[s.format]) then
    return s.format
  end
  if s.enum then return "enum" end
  if s.type == "array" then
    local items = unwrap(s.items or {})
    if items.format == "ref" then return "refs" end
    if items.type == "string" then return "strings" end
    return "unknown"
  end
  if s.type == "integer" then return "number" end
  if s.type == "string" or s.type == "number" or s.type == "boolean" then
    return s.type
  end
  return "unknown"
end

local kindWidgets = {
  string = "textInput", number = "numberInput", boolean = "booleanInput",
  date = "dateInput", enum = "selectInput", ref = "refInput",
  refs = "refListInput", strings = "listInput", tags = "tagsInput",
  identities = "identitiesInput",
}

--- Picks the input for a JSON Schema property (a registered `widgets.inputFormats` entry, enum, ref, tags, identities, list, date or a plain type) and passes `opts` on.
--- @param schema table the property schema
--- @param opts? table { value?: any, onChange: function(value), readOnly?: boolean } plus any option of the chosen input; the schema's `description` becomes the tooltip
--- @return table an inline widget
--- @see API/widgets
function widgets.schemaInput(schema, opts)
  local s = unwrap(schema or {})
  local o = {}
  for k, v in pairs(opts or {}) do o[k] = v end
  o.schema = s
  if s.format and widgets.inputFormats[s.format] then
    return widgets.inputFormats[s.format](o)
  end
  local kind = kindOf(s)
  if kind == "enum" then o.options = o.options or s.enum end
  if kind == "ref" then o.tag = o.tag or s.tag end
  if kind == "refs" then o.tag = o.tag or unwrap(s.items or {}).tag end
  local name = kindWidgets[kind]
  if not name then return dom.span { class = "sb-in-plain", dom.text("(not editable here)") } end
  local node = widgets[name](o)
  if s.description and node.title == "" then node.title = s.description end
  return node
end


widgets.inputSchema = {
  unwrap = unwrap,
  kindOf = kindOf,
}
```
