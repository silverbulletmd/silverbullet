#meta

# Implementation
```space-lua
share = {}

local shareSchema = {
  type = "object",
  properties = {
    uri = schema.string(),
    hash = schema.string(),
    mode = schema.string(), -- push | pull | sync
  },
}

-- Content change detection hash of 8 characters
-- First strips out share frontmatter-related keys to avoid hash-induced change detections
function share.contentHash(content)
  content = share.cleanFrontmatter(content)
  return crypto.sha256(content):sub(1, 8)
end

function share.cleanFrontmatter(text)
  return index.patchFrontmatter(text, {
    {op="delete-key", path="share.uri"},
    {op="delete-key", path="share.hash"},
    {op="delete-key", path="share.mode"},
  })
end

function share.setFrontmatter(m, text)
  return index.patchFrontmatter(text, {
    {op="set-key", path="share.uri", value=m.uri},
    {op="set-key", path="share.hash", value=m.hash},
    {op="set-key", path="share.mode", value=m.mode}
  })
end


-- Returns true if actually performed share, false if it was a no-op
function share.sharePage(name)
  local updateCurrent = not name
  local text
  if updateCurrent then
    text = editor.getText()
    name = editor.getCurrentPage()
  else
    text = space.readPage(name)
  end
  
  local m = index.extractFrontmatter(text).frontmatter.share
  if not m or type(m) != "table" then
    error("Not configured")
  end

  print("Current share frontmatter", m)
  
  local mode = m.mode or "push"
  local oldHash = m.hash
  local newLocalHash = share.contentHash(text)
  local newHash = newLocalHash

  if mode == "sync" then
    local remoteText = net.readURI(m.uri, {encoding="text/markdown"})
    if not remoteText then
      error("Could not read " .. m.uri)
    end
    -- Two-way sync mode
    local newRemoteHash = share.contentHash(remoteText)
    -- Sync cases
    if oldHash == newLocalHash and oldHash == newRemoteHash then
      print("Both sides up to date: nothing to do")
      return false
    elseif oldHash != newLocalHash and oldHash == newRemoteHash then
      print("Local changes, not remote one: local -> remote")
      net.writeURI(m.uri, share.cleanFrontmatter(text))
    elseif oldHash == newLocalHash and oldHash != newRemoteHash then
      print("Remote changes, not local ones: remote -> local")
      text = remoteText
      newHash = newRemoteHash
    else
      print("Changes on both ends: conflict")
      error("Conflict: not implemented yet")
    end
  elseif mode == "push" then
    if oldHash == newLocalHash then
      print("No local changes: nothing to do")
      return false
    else
      print("Local changes in push mode: local -> remote")
      net.writeURI(m.uri, share.cleanFrontmatter(text))
    end 
  elseif mode == "pull" then
    local remoteText = net.readURI(m.uri, {encoding="text/markdown"})
    if not remoteText then
      error("Could not read " .. m.uri)
    end
    local newRemoteHash = share.contentHash(remoteText)
    if oldHash == newRemoteHash then
      print("No remote changes: nothing to do")
      return false
    else
      if oldHash != newLocalHash then
        -- Local changes made since last pull, warn user
        if not editor.confirm("Local changes made to " .. name .. " are you ok to overwrite them with updated remote content from " .. m.uri .. "?") then
          return false
        end
      end  
      print("Remote changes in pull mode: remote -> local")
      text = remoteText
      newHash = newRemoteHash
    end
  end

  -- Update frontmatter
  m.hash = newHash
  m.mode = mode
  local updatedText = share.setFrontmatter(m, text)
  if updateCurrent then
    editor.setText(updatedText)
  else
    space.writePage(name, updatedText)
  end
  return true
end

command.define {
  name = "Share: Page",
  key = "Ctrl-p",
  mac = "Cmd-p",
  run = function()
    local ok, ret = pcall(share.sharePage)
    if ok then
      if ret then
        editor.flashNotification "Share successful"
      else
        editor.flashNotification "No changes"
      end
    else -- error
      if ret == "Not configured" then
        local data = {
          name = editor.getCurrentPage(),
          text = editor.getText()
        }
        local shareProviders = service.discover("share:onboard", data)
        local provider = editor.filterBox("Share provider", shareProviders, "Select how you would like to share this page")
        if not provider then
          return
        end
  
        print("Selected", provider)
        local m = service.invoke(provider, data)
        if m then
          editor.setText(share.setFrontmatter(m, data.text))
          editor.flashNotification "Share complete!"
        end
      else
        editor.flashNotification("Error: ".. ret)
      end
    end
  end
}
```
