#meta

Push-time transforms for [[Share]]: what is rewritten or removed from a page before it leaves this space.

# Implementation
```space-lua
-- priority: 9

-- Used when no provider claims a URI
share.genericTarget = {
  kind = "other",
  defaults = {links = true, comments = true, frontmatter = true, bake = true},
  link = function(l)
    return l.text
  end,
}

-- The descriptor of the provider that serves uri (see share:target services)
function share.target(uri)
  local matches = service.discover("share:target:" .. uri, {uri = uri})
  if matches and #matches > 0 then
    return service.invoke(matches[1], {uri = uri})
  end
  return share.genericTarget
end

local function isMetaTag(tag)
  tag = tostring(tag):gsub("^#", "")
  return tag == "meta" or tag:startsWith("meta/")
end

local function hasMetaTag(tags)
  if type(tags) == "string" then
    return isMetaTag(tags)
  end
  if type(tags) == "table" then
    for _, tag in ipairs(tags) do
      if isMetaTag(tag) then
        return true
      end
    end
  end
  return false
end

-- Library pages (tagged meta or meta/*) are shared as they are
function share.isExempt(name, text)
  if hasMetaTag(index.extractFrontmatter(text).frontmatter.tags) then
    return true
  end
  local ok, meta = pcall(space.getPageMeta, name)
  return ok and meta != nil and hasMetaTag(meta.tags)
end

local stepNames = {"links", "comments", "frontmatter", "bake"}

-- override is false (everything off) or a table of steps set to false
function share.resolveSteps(name, text, target, override)
  local steps = {}
  local exempt = share.isExempt(name, text)
  for _, step in ipairs(stepNames) do
    steps[step] = not exempt and target.defaults[step] == true
      and override != false
      and not (type(override) == "table" and override[step] == false)
  end
  return steps
end

local function replaceNode(node, text)
  node.children = nil
  node.text = text
end

-- "Page#Header" -> page, anchor; "Page@123" positions are dropped
local function splitRef(ref)
  local anchor
  local hash = ref:find("#", 1, true)
  if hash then
    anchor = ref:sub(hash + 1)
    ref = ref:sub(1, hash - 1)
  end
  ref = ref:gsub("@[%d:]+$", "")
  return ref, anchor
end

local function linkOf(wikiLink)
  local ref, alias
  for _, child in ipairs(wikiLink.children) do
    if child.type == "WikiLinkPage" then
      ref = markdown.renderParseTree(child)
    elseif child.type == "WikiLinkAlias" then
      alias = markdown.renderParseTree(child)
    end
  end
  local page, anchor = splitRef(ref or "")
  return {
    page = page,
    anchor = anchor,
    alias = alias,
    text = alias or (page != "" and page or anchor) or "",
  }
end

local function rewriteLink(node, wikiLink, transclusion, ctx)
  local link = linkOf(wikiLink)
  link.transclusion = transclusion
  local isMember = link.page == "" or link.page == ctx.page
    or ctx.members[link.page] != nil
  if isMember then
    link.fromUri = ctx.uri
    link.toUri = ctx.members[link.page]
    replaceNode(node, ctx.target.link(link))
  elseif transclusion then
    replaceNode(node, "")
  else
    replaceNode(node, link.text)
  end
end

local function walk(node, ctx)
  if node.children == nil then
    return
  end
  if node.type == "Image" and node.children[1] != nil
      and node.children[1].type == "WikiLink" then
    rewriteLink(node, node.children[1], true, ctx)
  elseif node.type == "WikiLink" then
    rewriteLink(node, node, false, ctx)
  else
    for _, child in ipairs(node.children) do
      walk(child, ctx)
    end
  end
end

local function stripComments(node)
  if node.children == nil then
    return
  end
  if node.type == "CommentBlock" or node.type == "Comment" then
    replaceNode(node, "")
    return
  end
  local removedBlock = false
  for _, child in ipairs(node.children) do
    -- A removed block takes the blank line after it along, so no gap is left
    if removedBlock and child.children == nil and child.text
        and child.text:match("^\n+$") then
      replaceNode(child, "")
    end
    removedBlock = child.type == "CommentBlock"
    stripComments(child)
  end
end

local keptKeys = {"title", "description", "tags"}

-- Rebuilt from the kept keys rather than deleting the others, so keys can't
-- slip through by how they are spelled (dotted, quoted)
local function stripFrontmatter(text)
  local tree = markdown.parseMarkdown(text)
  local node
  for _, child in ipairs(tree.children or {}) do
    if child.type == "FrontMatter" then
      node = child
      break
    end
  end
  if node == nil then
    return text
  end
  -- +1 skips the newline after the closing marker
  local block = text:sub(1, node.to)
  local body = text:sub(node.to + 2)
  local frontmatter = index.extractFrontmatter(block).frontmatter
  local patches = {}
  for _, key in ipairs(keptKeys) do
    local value = frontmatter[key]
    if value != nil and not (type(value) == "table" and next(value) == nil) then
      table.insert(patches, {op = "set-key", path = key, value = value})
    end
  end
  if #patches == 0 then
    return body
  end
  return index.patchFrontmatter(body, patches)
end

-- Baked sections are kept in their expanded form; only the markers go. The
-- newline after a marker goes with it so the body stays on its own line.
local function dropBakedMarkers(node)
  if node.children == nil then
    return
  end
  local children = node.children
  for i, child in ipairs(children) do
    if child.type == "CommentMarkerBlock" then
      replaceNode(child, "")
      local nextChild = children[i + 1]
      if nextChild != nil and nextChild.type == nil
          and nextChild.text == "\n" then
        nextChild.text = ""
      end
    else
      dropBakedMarkers(child)
    end
  end
end

local function bake(text)
  text = markdown.bakeSections(text)
  text = markdown.expandMarkdown(text, {
    expandTransclusions = false,
    rewriteTasks = false,
  })
  local tree = markdown.parseMarkdown(text)
  dropBakedMarkers(tree)
  return markdown.renderParseTree(tree)
end

-- Extensions (selector share:transform, match = {name, order}) run after the
-- built-in steps, in ascending order (default 100)
local function runExtensions(text, ctx)
  local matches = service.discover("share:transform", {}) or {}
  local ordered = {}
  for i, match in ipairs(matches) do
    table.insert(ordered, {match = match, index = i})
  end
  table.sort(ordered, function(a, b)
    local orderA = a.match.order or 100
    local orderB = b.match.order or 100
    if orderA != orderB then
      return orderA < orderB
    end
    return a.index < b.index
  end)
  for _, entry in ipairs(ordered) do
    text = service.invoke(entry.match, {text = text, ctx = ctx})
  end
  return text
end

function share.transform(text, ctx)
  -- share.transform: false publishes the page unchanged, extensions included
  local m = index.extractFrontmatter(text).frontmatter.share
  local optedOut = type(m) == "table" and m.transform == false
  text = share.cleanFrontmatter(text)
  local exempt = share.isExempt(ctx.page, text)
  local steps = ctx.steps
  if steps.bake then
    text = bake(text)
  end
  if steps.links or steps.comments then
    local tree = markdown.parseMarkdown(text)
    if steps.links then
      walk(tree, ctx)
    end
    if steps.comments then
      stripComments(tree)
    end
    text = markdown.renderParseTree(tree)
  end
  if steps.frontmatter then
    text = stripFrontmatter(text)
  end
  if not exempt and not optedOut then
    text = runExtensions(text, ctx)
  end
  return text
end
```
