#meta

The page-facing side of [[Share]]: listing shared pages, opening and copying their web links, onboarding a page to a share provider, unsharing, and the Share commands.

# Implementation
```space-lua
-- priority: 7

local function kindOf(tags)
  for _, tag in ipairs(tags or {}) do
    if tag == "meta/library" then
      return "library"
    elseif tag == "meta/repository" then
      return "repository"
    end
  end
  return "page"
end

-- Every page with a share.uri, by name
function share.list()
  local shared = {}
  for _, p in ipairs(index.queryLuaObjects("page", {})) do
    if type(p.share) == "table" and p.share.uri then
      table.insert(shared, {
        name = p.name,
        uri = p.share.uri,
        mode = p.share.mode or "push",
        kind = kindOf(p.tags),
      })
    end
  end
  table.sort(shared, function(a, b)
    return a.name < b.name
  end)
  return shared
end

-- Where uri can be viewed in a browser, or nil
function share.webUrl(uri)
  local target = share.target(uri)
  if target.webUrl then
    local ok, url = pcall(target.webUrl, uri)
    return ok and url or nil
  end
  if uri:startsWith("http://") or uri:startsWith("https://") then
    return uri
  end
  return nil
end

-- uri's web URL, or nil after telling the user
local function notifiedWebUrl(uri)
  local url = share.webUrl(uri)
  if not url then
    editor.flashNotification("No web page for " .. uri)
  end
  return url
end

-- Opens uri's web page in the browser
function share.openRemote(uri)
  local url = notifiedWebUrl(uri)
  if url then
    editor.openUrl(url)
  end
end

-- Copies the link to uri's web page
function share.copyLink(uri)
  local url = notifiedWebUrl(uri)
  if url then
    editor.copyToClipboard(url)
    editor.flashNotification "Copied"
  end
end

-- The shared pages Share: All Changed shares: sync pages changed since their
-- last share (as share.hash tells), and push pages whose remote differs or is
-- missing (read to tell). Pull pages never.
function share.changedPages()
  local names = {}
  for _, p in ipairs(share.list()) do
    -- A page that can't be prepared or checked is left for its own share to
    -- report
    if p.mode == "sync" then
      local ok, status = pcall(share.status, p.name)
      if ok and status.state == "localChanged" then
        table.insert(names, p.name)
      end
    elseif p.mode == "push" then
      local state = share.check({p.name})[p.name].state
      if state == "differs" or state == "missing" then
        table.insert(names, p.name)
      end
    end
  end
  return names
end

-- Stops sharing the page (the current one without a name): removes its share
-- keys. The remote copy stays.
function share.unshare(name)
  local text
  if name then
    text = space.readPage(name)
  else
    text = editor.getText()
  end
  local cleaned = share.cleanFrontmatter(text)
  if name then
    space.writePage(name, cleaned)
  else
    editor.setText(cleaned)
  end
end

-- Offers the share providers for the current page and shares it to the one
-- picked; a failed first share leaves the page unshared, so the providers are
-- offered again next time
local function onboard(name, text)
  -- What a provider that uploads during onboarding may publish
  local prepared, content = pcall(share.transform, text, {
    page = name,
    target = share.genericTarget,
    members = {},
    steps = share.resolveSteps(name, text, share.genericTarget),
  })
  if not prepared then
    editor.flashNotification("Error: " .. content, "error")
    return
  end
  local data = {name = name, text = text, content = content}
  local shareProviders = service.discover("share:onboard", data)
  local provider = editor.filterBox("Share provider", shareProviders, "Select how you would like to share this page")
  if not provider then
    return
  end

  local onboarded, m = pcall(service.invoke, provider, data)
  if not onboarded then
    editor.flashNotification("Error: " .. m, "error")
    return
  elseif not m then
    return
  end
  -- Any hash a provider returns is ignored: a sync share writes its own
  editor.setText(share.setFrontmatter(
    {uri = m.uri, mode = m.mode, transform = m.transform}, data.text))
  -- Uploads the page unless the provider already did
  local shared, err = pcall(share.sharePage)
  if not shared then
    editor.setText(data.text)
    editor.flashNotification("Error: " .. err, "error")
    return
  end
  editor.flashNotification "Share complete!"
end

-- Tells the user how a share went, from what pcall(share.sharePage) returned
function share.notifyShared(ok, ret)
  if not ok then
    editor.flashNotification("Error: " .. ret, "error")
  elseif ret then
    editor.flashNotification "Share successful"
  elseif ret == false then
    editor.flashNotification "No changes"
  end -- nil: sharePage already notified
end

command.define {
  name = "Share: Page",
  key = "Ctrl-p",
  mac = "Cmd-p",
  run = function()
    local ok, ret = pcall(share.sharePage)
    if not ok and ret == "Not configured" then
      onboard(editor.getCurrentPage(), editor.getText())
    else
      share.notifyShared(ok, ret)
    end
  end
}

-- The current page's share.uri, or nil after telling the user
local function currentUri()
  local m = index.extractFrontmatter(editor.getText()).frontmatter.share
  if type(m) != "table" or m.uri == nil then
    editor.flashNotification(editor.getCurrentPage() .. " isn't shared", "error")
    return nil
  end
  return m.uri
end

command.define {
  name = "Share: Open Remote",
  run = function()
    local uri = currentUri()
    if uri then
      share.openRemote(uri)
    end
  end
}

command.define {
  name = "Share: Copy Link",
  run = function()
    local uri = currentUri()
    if uri then
      share.copyLink(uri)
    end
  end
}

command.define {
  name = "Share: Unshare",
  requireMode = "rw",
  run = function()
    local uri = currentUri()
    if uri and editor.confirm("Stop sharing " .. editor.getCurrentPage()
        .. "? The copy at " .. uri .. " stays.") then
      share.unshare()
    end
  end
}

command.define {
  name = "Share: All Changed",
  requireMode = "rw",
  run = function()
    local names = share.changedPages()
    local collections = share.changedCollections()
    local total = #names + #collections
    if total == 0 then
      editor.flashNotification "Nothing to share"
      return
    end
    local results = share.shareMany(names)
    local shared, firstFailure = 0, nil
    local function failed(name, message)
      firstFailure = firstFailure or (name .. ": " .. message)
    end
    for _, name in ipairs(names) do
      local r = results[name]
      if r.ok then
        shared = shared + 1
      else
        failed(name, r.error)
      end
    end
    for _, name in ipairs(collections) do
      local ok, r = pcall(share.publishCollection, name)
      if not ok then
        failed(name, tostring(r))
      elseif r.cancelled then
        -- Neither shared nor failed: the user knows
      elseif #r.failed > 0 then
        failed(name, share.collectionFailure(r.failed[1]))
      else
        shared = shared + 1
      end
    end
    editor.flashNotification("Shared " .. shared .. " of " .. total)
    if firstFailure then
      editor.flashNotification(firstFailure, "error")
    end
  end
}
```
