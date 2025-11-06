#meta

# Implementation
```space-lua
mirror = {}

local mirrorSchema = {
  type = "object",
  properties = {
    uri = schema.string(),
    hash = schema.string(),
    mode = schema.string(), -- push | pull | sync
  },
}

-- Content change detection hash of 8 characters
-- First strips out mirror frontmatter-related keys to avoid hash-induced change detections
function mirror.contentHash(content)
  content = mirror.cleanFrontmatter(content)
  return crypto.sha256(content):sub(1, 8)
end

function mirror.cleanFrontmatter(text)
  return index.patchFrontmatter(text, {
    {op="delete-key", path="mirror.uri"},
    {op="delete-key", path="mirror.hash"},
    {op="delete-key", path="mirror.mode"},
  })
end

function mirror.setFrontmatter(m, text)
  return index.patchFrontmatter(text, {
    {op="set-key", path="mirror.uri", value=m.uri},
    {op="set-key", path="mirror.hash", value=m.hash},
    {op="set-key", path="mirror.mode", value=m.mode}
  })
end

function mirror.syncPage(name)
  local updateCurrent = not name
  local text
  if updateCurrent then
    text = editor.getText()
    name = editor.getCurrentPage()
  else
    text = space.readPage(name)
  end
  
  local m = index.extractFrontmatter(text).frontmatter.mirror
  if not m or type(m) != "table" then
    error("Not configured")
  end

  print("Current mirror", m)
  
  local remoteText = readURI(m.uri, {encoding="text/markdown"})
  if not remoteText then
    error("Could not read " .. m.uri)
  end

  local mode = m.mode or "push"
  local oldHash = m.hash
  local newLocalHash = mirror.contentHash(text)
  local newHash = newLocalHash

  if mode == "sync" then
    -- Two-way sync mode
    local newRemoteHash = mirror.contentHash(remoteText)
    -- Sync cases
    if oldHash == newLocalHash and oldHash == newRemoteHash then
      print("Both sides up to date: nothing to do")
    elseif oldHash != newLocalHash and oldHash == newRemoteHash then
      print("Local changes, not remote one: local -> remote")
      writeURI(m.uri, mirror.cleanFrontmatter(text))
    elseif oldHash == newLocalHash and oldHash != newRemoteHash then
      print("Remote changes, not local ones: remote -> local")
    else
      print("Changes on both ends: conflict")
    end
  elseif mode == "push" then
    if oldHash == newLocalHash then
      print("No local changes: nothing to do")
    else
      print("Local changes in push mode: local -> remote")
      writeURI(m.uri, mirror.cleanFrontmatter(text))
    end 
  elseif mode == "pull" then
    local newRemoteHash = remote.contentHash(remoteText)
    if oldHash == newRemoteHash then
      print("No remote changes: nothing to do")
    else
      if oldHash != newLocalHash then
        -- Local changes made since last pull, warn user
        if not editor.confirm("Local changes made to " .. name .. " are you ok to overwrite them with updated remote content from " .. m.uri .. "?") then
          return
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
  local updatedText = mirror.setFrontmatter(m, text)
  if updateCurrent then
    editor.setText(updatedText)
  else
    space.writePage(name, updatedText)
  end
end

command.define {
  name = "Mirror: Page",
  key = "Ctrl-p",
  mac = "Cmd-p",
  run = function()
    local ok, err = pcall(mirror.syncPage)
    if not ok and err == "Not configured" then
      local data = {
        name = editor.getCurrentPage(),
        text = editor.getText()
      }
      local mirrorProviders = service.discover("mirror:onboard", data)
      local provider = editor.filterBox("Select mirror provider", mirrorProviders)
      if not provider then
        return
      end

      print("Selected", provider)
      local m = service.invoke(provider, data)
      if m then
        editor.setText(mirror.setFrontmatter(m, data.text))
        editor.flashNotification "Mirror complete!"
      end
    elseif not ok then
      print("Error", err)
    end
  end
}
```
