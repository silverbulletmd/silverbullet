#meta

Push-time transforms for [[Share]]: what is rewritten or removed from a page before it leaves this space.

# Implementation
```space-lua
-- priority: 9

-- Used when no provider claims a URI
share.genericTarget = {
  kind = "other",
  defaults = {links = true, comments = true, bake = true},
  link = function(l)
    return l.text
  end,
  -- Where a collection member goes under the target root
  memberUri = function(root, path)
    return root .. "/" .. path .. ".md"
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

local stepNames = {"links", "comments", "bake"}

-- override is false (everything off) or a table of steps set to false.
-- extensions: the share:transform services, off for exempt pages and with
-- share.transform: false.
function share.resolveSteps(name, text, target, override)
  local exempt = share.isExempt(name, text)
  local steps = {extensions = not exempt and override != false}
  for _, step in ipairs(stepNames) do
    steps[step] = steps.extensions and target.defaults[step] == true
      and not (type(override) == "table" and override[step] == false)
  end
  return steps
end

local function replaceNode(node, text)
  node.children = nil
  node.text = text
end

-- "Page#Header" and "Page$anchor" -> page, anchor; positions ("@123",
-- "@L12C3") and a leading "^" are dropped
local function splitRef(ref)
  ref = ref:gsub("^%^", "")
  local anchor
  local at = ref:find("[#$]")
  if at then
    anchor = ref:sub(at + 1)
    ref = ref:sub(1, at - 1)
  end
  ref = ref:gsub("@L?%d+[C:]?%d*$", "")
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

-- Replaces the block children[i] with text (by default nothing). The
-- newlines after a removed block go too when a blank line already separates
-- it from what came before (or nothing follows), so no gap is left; else one
-- stays, so the blocks on either side don't merge.
local function removeBlock(children, i, text)
  replaceNode(children[i], text or "")
  local after = children[i + 1]
  if text != nil and text != "" or after == nil or after.children != nil
      or not (after.text or ""):match("^\n+$") then
    return
  end
  local before = children[i - 1]
  local separated = before == nil or children[i + 2] == nil
    or (before.children == nil and (before.text or ""):match("\n\n$"))
  after.text = separated and "" or "\n"
end

-- The markers of baked sections: <!--#lua EXPR --> and <!--/lua-->
local function isBakedMarker(node)
  local text = markdown.renderParseTree(node)
  return text:match("^%s*<!%-%-#lua%s") != nil or text:match("^%s*<!%-%-/lua%-%->") != nil
end

local function stripComments(node)
  if node.children == nil then
    return
  end
  for i, child in ipairs(node.children) do
    if child.type == "Comment" and not isBakedMarker(child) then
      replaceNode(child, "")
    elseif child.type == "CommentBlock"
        or (child.type == "CommentMarkerBlock" and not isBakedMarker(child)) then
      removeBlock(node.children, i)
    else
      stripComments(child)
    end
  end
end

-- Baked sections are kept in their expanded form; only the markers go. A
-- marker line keeps any text after the marker.
local function dropBakedMarkers(node)
  if node.children == nil then
    return
  end
  for i, child in ipairs(node.children) do
    if child.type == "CommentMarkerBlock" and isBakedMarker(child) then
      local rest = markdown.renderParseTree(child):gsub("^%s*<!%-%-.-%-%->%s*", "")
      removeBlock(node.children, i, rest)
    elseif child.type == "Comment" and isBakedMarker(child) then
      replaceNode(child, "")
    else
      dropBakedMarkers(child)
    end
  end
end

-- Directives run as the shared page, wherever the editor is
local function bake(text, page)
  text = markdown.bakeSections(text, page)
  text = markdown.expandMarkdown(text, {
    expandTransclusions = false,
    rewriteTasks = false,
    pageName = page,
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
    -- Nothing returned: nothing to change
    local result = service.invoke(entry.match, {text = text, ctx = ctx})
    if type(result) == "string" then
      text = result
    elseif result != nil then
      error("share:transform " .. tostring(entry.match.name)
        .. " returned a " .. type(result) .. ", not text")
    end
  end
  return text
end

function share.transform(text, ctx)
  text = share.cleanFrontmatter(text)
  local steps = ctx.steps
  if steps.bake then
    text = bake(text, ctx.page)
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
  if steps.extensions then
    text = runExtensions(text, ctx)
  end
  return text
end
```
