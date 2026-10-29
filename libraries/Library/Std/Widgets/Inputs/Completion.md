---
description: Wikilink parsing, completion ranking and indexed reference candidates.
tags: meta
---
Wikilink parsing, completion ranking and indexed reference candidates. Internal implementation of [[Library/Std/Widgets/Inputs]].

```space-lua
-- priority: 50
widgets = widgets or {}
local function isWikilink(v)
  return type(v) == "string"
    and #v > 4
    and v:sub(1, 2) == "[["
    and v:sub(-2) == "]]"
    and not v:sub(3, -3):find("]]", 1, true)
end

local function linkTarget(v)
  if not isWikilink(v) then return nil end
  local inner = v:sub(3, -3)
  local bar = inner:find("|", 1, true)
  if bar then inner = inner:sub(1, bar - 1) end
  return inner
end

-- Text cut into plain runs and wikilinks: { text = … } or
-- { link = "[[…]]", target = …, label = … } (the alias when there is one)
local function linkSegments(text)
  text = tostring(text or "")
  local segments, pos = {}, 1
  while pos <= #text do
    local s, e, inner = text:find("%[%[([^%[%]]-)%]%]", pos)
    if not s then break end
    if inner ~= "" then
      if s > pos then table.insert(segments, { text = text:sub(pos, s - 1) }) end
      local target, alias = inner, nil
      local bar = inner:find("|", 1, true)
      if bar then target, alias = inner:sub(1, bar - 1), inner:sub(bar + 1) end
      table.insert(segments, {
        link = text:sub(s, e),
        target = target,
        label = (alias and alias ~= "") and alias or target,
      })
      pos = e + 1
    else
      table.insert(segments, { text = text:sub(pos, e) })
      pos = e + 1
    end
  end
  if pos <= #text then table.insert(segments, { text = text:sub(pos) }) end
  return segments
end

local function hasLinks(text)
  for _, segment in ipairs(linkSegments(text)) do
    if segment.link then return true end
  end
  return false
end

-- The link being typed at `caret` (characters before the caret): the
-- position of its `[[` (0-based) and the text typed after it, or nil
local function linkPrefix(text, caret)
  local before = tostring(text or ""):sub(1, caret)
  local open
  local from = 1
  while true do
    local at = before:find("[[", from, true)
    if not at then break end
    open = at
    from = at + 1
  end
  if not open then return nil end
  local typed = before:sub(open + 2)
  -- Past `]]`, in a new `[`, on another line or in the alias: not a target
  if typed:find("]]", 1, true) or typed:find("[", 1, true)
    or typed:find("\n", 1, true) or typed:find("|", 1, true) then
    return nil
  end
  return { start = open - 1, typed = typed }
end

-- `text` with the typed `[[…` at `prefix` replaced by `link`; returns the
-- text and the caret after the link. When the caret is inside a link that
-- is already closed, its whole target goes, and its alias stays
local function insertLink(text, caret, prefix, link)
  text = tostring(text or "")
  local after = text:sub(caret + 1)
  local close = after:find("]]", 1, true)
  if close then
    local rest = after:sub(1, close - 1)
    if not rest:find("[[", 1, true) and not rest:find("\n", 1, true) then
      local bar = rest:find("|", 1, true)
      if bar then link = link:sub(1, -3) .. rest:sub(bar) .. "]]" end
      after = after:sub(close + 2)
    end
  end
  local before = text:sub(1, prefix.start)
  return before .. link .. after, #before + #link
end

-- An exact match first, then options whose label starts with `typed`, then those containing it
local function filterOptions(options, typed, taken, key, limit)
  key = key or function(v) return v end
  local needle = (typed or ""):lower()
  local starts, contains = {}, {}
  for _, o in ipairs(options or {}) do
    if not (taken and taken[key(o.value)]) then
      local label = tostring(o.label or o.value):lower()
      local at = label:find(needle, 1, true)
      if needle ~= "" and (label == needle or label == "#" .. needle or label == "@" .. needle) then
        table.insert(starts, 1, o)
      elseif at == 1 then
        table.insert(starts, o)
      elseif at then
        table.insert(contains, o)
      end
    end
  end
  for _, o in ipairs(contains) do table.insert(starts, o) end
  limit = limit or 8
  while #starts > limit do table.remove(starts) end
  return starts
end

-- A ref option for an indexed object, or nil when it can't be a ref target
local function refOption(o)
  if o.tag == "page" then
    return { name = o.name, link = "[[" .. o.name .. "]]" }
  end
  local anchor = o.ref
  if type(anchor) ~= "string" or not anchor:match("^[%a_][%w_/:%-]*$") then
    return nil
  end
  local hostTag = o.tag == "anchor" and o.hostTag or o.tag
  return {
    name = "$" .. anchor,
    description = tostring(hostTag) .. " on " .. tostring(o.page),
    link = "[[$" .. anchor .. "]]",
  }
end

local function refCandidates(tagName)
  local options, seen = {}, {}
  local function addAll(objects)
    for _, o in ipairs(objects) do
      local option = refOption(o)
      if option and not seen[option.name] then
        seen[option.name] = true
        table.insert(options, option)
      end
    end
  end
  if tagName then
    addAll(query[[from o = index.tag(tagName)]])
  else
    addAll(query[[from o = index.tag("page")]])
    addAll(query[[from o = index.tag("anchor")]])
  end
  return options
end

-- Pages and anchored objects for `[[` completion, fetched on first use by
-- each field (so pages created since show up)
local function linkOptionsFetcher()
  local cache
  return function()
    if cache == nil then
      -- Filled before it's shared: a keystroke during the fetch must not
      -- see a half-built list
      local options = {}
      for _, o in ipairs(refCandidates(nil)) do
        table.insert(options, { value = o.link, label = o.name, description = o.description })
      end
      cache = options
    end
    return cache
  end
end

-- Distinct, sorted names of `tag` records: one record exists per use of a
-- tag, and records of other tags can carry a `name` too
local function uniqueTagNames(objects)
  local names, seen = {}, {}
  for _, t in ipairs(objects or {}) do
    local name = t.name
    if t.tag == "tag" and not t.inComment and type(name) == "string"
      and name ~= "" and not seen[name] then
      seen[name] = true
      table.insert(names, name)
    end
  end
  table.sort(names)
  return names
end

local function tagNames()
  return uniqueTagNames(query[[from t = index.tag("tag")]])
end


widgets.inputCompletion = {
  isWikilink = isWikilink,
  linkTarget = linkTarget,
  linkSegments = linkSegments,
  hasLinks = hasLinks,
  linkPrefix = linkPrefix,
  insertLink = insertLink,
  filterOptions = filterOptions,
  refOption = refOption,
  refCandidates = refCandidates,
  linkOptionsFetcher = linkOptionsFetcher,
  uniqueTagNames = uniqueTagNames,
  tagNames = tagNames,
}
```
