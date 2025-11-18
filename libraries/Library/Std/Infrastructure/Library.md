#meta

This implements library management

# Implementation
```space-lua
-- namespace
library = {
  libraryTag = "meta/library",
  remoteLibraryTag = "meta/library/remote",
  repositoryTag = "meta/repository"
}

local libraryPrefix = "Library/"
local repositoryPrefix = "Repositories/"

-- Schema of frontmatter of the library page
-- Schema of #meta/library objects
local librarySchema = {
  type = "object",
  properties = {
    name = schema.string(),
    files = schema.array(schema.string())
  },
  required = {"name"}
}

local remoteLibrarySchema = {
  type = "object",
  properties = {
    name = schema.string(),
    description = schema.string(),
    website = schema.string(),
    uri = schema.string(),
  },
  required = {"name", "uri"}
}

-- Repo management commands
command.define {
  name = "Library: Add Repository",
  run = function()
    local repoUri = editor.prompt("URI:")
    if not repoUri then
      return
    end
    local text = net.readURI(repoUri, {encoding="text/markdown"})
    local suggestedName = library.suggestRepoNameFromUri(repoUri)
    local repoPage = editor.prompt("Install into:", repositoryPrefix .. suggestedName)
    if not repoPage then
      return
    end
    if space.pageExists(repoPage) then
      editor.flashNotification(repoPage .. " already exists", "error")
      return
    end
    space.writePage(repoPage, share.setFrontmatter({
      uri = repoUri,
      hash = share.contentHash(text),
      mode = "pull"
    }, text))
    editor.flashNotification "Library installed"
    editor.navigate(repoPage)
    reloadEverything()
  end
}

command.define {
  name = "Library: Update All Repositories",
  run = function()
    for repo in query[[from index.tag(library.repositoryTag)]] do
      if repo.share then
        share.sharePage(repo.name)
      end
    end
    editor.flashNotification "All repositories updated"
  end
}

-- Library management commands
command.define {
  name = "Library: Install",
  run = function()
    local uri = editor.prompt("URI:")
    if not uri then
      return
    end
    library.install(uri)
    editor.flashNotification "Library installed"
    reloadEverything()
    editor.navigate("Library/Std/Pages/Library Manager")
  end
}

command.define {
  name = "Library: Update All",
  run = function()
    for lib in query[[
      from index.tag(library.libraryTag)
      where _.share and _.share.mode == "pull"
    ]] do
      if library.update(lib.name, false) then
        editor.flashNotification("Updated " .. lib.name)
      end
    end
    editor.flashNotification "Update complete!"
    reloadEverything()
  end
}

command.define {
  name = "Library: Manager",
  run = function()
    editor.navigate("Library/Std/Pages/Library Manager")
  end
}

-- Look up an installed library by name
function library.getInstalled(uri)
  local installedFMs = query[[
    from index.tag(library.libraryTag)
    where _.share and _.share.uri == uri
  ]]
  if #installedFMs == 0 then
    return nil
  else
    return installedFMs[1]
  end
end

-- Install a library
function library.install(uri, currentHash)
  -- Fetch from remote URL
  local text = net.readURI(uri, {
    encoding = "text/markdown"
  })

  if not text then
    error("Could not fetch: " .. uri)
  end

  local remoteLibFM = index.extractFrontmatter(text).frontmatter
  local remoteHash = share.contentHash(text)
  
  local err = jsonschema.validateObject(librarySchema, remoteLibFM)
  if err then
    editor.flashNotification("Library frontmatter validation error: " .. err, "error")
    return
  end
  
  local pageName = remoteLibFM.name

  -- If this is a fresh install, don't override existing pages
  if not currentHash and space.pageExists(pageName) then
    error("Page already exists: " .. pageName)
  end

  -- Check if update is required based on hash
  if currentHash and currentHash == remoteHash then
    return false
  end

  -- Ok, let's do this
  local sourceBase = urlDir(uri)
  local targetBase = urlDir(pageName)
  text = share.setFrontmatter({
    uri = uri,
    hash = remoteHash,
    mode = "pull"
  }, text)
  
  -- First write the main file
  space.writePage(pageName, text)
  
  -- And download and write assets, if any
  if remoteLibFM.files then
    for file in remoteLibFM.files do
      print("Downloading file", file)
      local targetPath = targetBase .. file
      local data = net.readURI(sourceBase .. file, {encoding="application/octet-stream"})
      if not data then
        error("Could not fetch file: " .. sourceBase .. file)
      end
      space.writeFile(targetPath, data)
    end
  end
  return true
end

-- Update a library
function library.update(pageName, force)
  local text = space.readPage(pageName)
  local fm = index.extractFrontmatter(text).frontmatter
  if fm.share then
     return library.install(fm.share.uri, fm.share.hash)
  else
    print("No 'share' key found in frontmatter for " .. pageName)
  end
end

function library.remove(pageName)
  local text = space.readPage(pageName)

  if not text then
    error("Could not read: " .. pageName)
  end

  local fm = index.extractFrontmatter(text).frontmatter

  local targetBase = urlDir(pageName)

  -- Remove associated files first
  if fm.files then
    for file in fm.files do
      local p = targetBase .. file
      space.deleteFile(p)
    end
  end
  
  -- Then page itself
  space.deletePage(pageName)
end

function library.installedLibrariesWidget()
  local rows = {}
  for lib in query[[
    from index.tag "meta/library"
  ]] do
    table.insert(rows, dom.tr {
      dom.td { "[[" .. lib.name .. "|" .. lib.name .. "]]" },
      dom.td {
        (
          not lib.share and ""
        ) or (
          lib.share.mode == "pull" and
          dom.span {
            widgets.button("Update", function()
              local updated = library.update(lib.name, true)
              if updated then
                editor.flashNotification "Updated."
                reloadEverything()
              else
                editor.flashNotification "No update available."
              end
            end, { class = "update" }),
            widgets.button("Remove", function()
              if editor.confirm("Are you sure?") then
                library.remove(lib.name)
                editor.flashNotification "Done!"
                reloadEverything()
              end
            end, { class = "remove"})  
          }
        ) or (
          dom.span {
            widgets.button("Publish", function()
              local updated = library.update(lib.name, true)
              if updated then
                editor.flashNotification "Published."
                reloadEverything()
              else
                editor.flashNotification "No changes to publish."
              end
            end, { class = "update" })
          }
        )
      }
    })
  end
  if #rows == 0 then
    rows = {
      dom.tr {
        dom.td { colspan="2", "_Nothing yet_" }
      }
    }
  end
  return widget.htmlBlock(dom.table {
    class = "manage-library",
    dom.thead {
      dom.tr {
        dom.td {"Library"},
        dom.td {"Action"}
      }
    },
    dom.tbody(rows)
  })
end

function library.installableLibrariesWidget()
  local installableLibraries = query[[from index.tag "meta/library/remote"]]
  local rows = {}
  for lib in query[[
    from installableLibraries where not library.getInstalled(_.uri)
  ]] do
    table.insert(rows, dom.tr {
      dom.td {
        dom.a {
          href = lib.website or lib.uri:startsWith("https://") and lib.uri,
          "**" .. lib.name .. "**",
        },
        " _([[" .. lib.page .. "]])_",
        lib.description and dom.p { lib.description } or ""
      },
      dom.td {
        widgets.button("Install", function()
          editor.flashNotification "Installing..."
          library.install(lib.uri)
          editor.flashNotification "Done!"
          reloadEverything()
        end, { class = "install" })
      }
    })
  end
  
  return widget.htmlBlock(dom.table {
    class = "manage-library",
    dom.thead {
      dom.tr {
        dom.td {"Library"},
        dom.td {"Action"}
      }
    },
    dom.tbody(rows)
  })
end

function library.installedRepositoriesWidget()
  local rows = {}
  for repo in query[[from index.tag(library.repositoryTag)]] do
    table.insert(rows, dom.tr {
      dom.td { "[[" .. repo.name .. "|" .. repo.name .. "]]" },
      dom.td {
        repo.share and dom.span {
          widgets.button("Update", function()
            if share.sharePage(repo.name) then
              editor.flashNotification "Repository updated"
              reloadEverything()
            else
              editor.flashNotification "No changes"
            end
          end),
          widgets.button("Remove", function()
            if editor.confirm("Are you sure?") then
              space.deletePage(repo.name)
              editor.flashNotification "Done!"
              reloadEverything()
            end
          end, { class = "remove" })
        } or ""
      }
    })
  end
  return widget.htmlBlock(dom.table {
    class = "manage-library",
    dom.thead {
      dom.tr {
        dom.td {"Repository"},
        dom.td {"Action"}
      }
    },
    dom.tbody(rows)
  })
end

-- Utility functions
local function urlDir(url)
  return string.match(url, "^(.*/)[^/]+$")
end

-- Construct full library path from name
function library.libPath(name)
  return libraryPrefix .. name
end

-- Extract name from full path
function library.libName(path)
  return path:sub(#libraryPrefix + 1)
end

function library.repoName(path)
  return path:sub(#repositoryPrefix + 1)
end

function library.suggestRepoNameFromUri(uri)
  -- Take the bit after the last :
  local uriParts = uri:split(":")
  local suggestedName = uriParts[#uriParts]
  -- Strip .md
  local suggestedName = suggestedName:gsub("%.md$", "")
  -- Strip any some generic names
  for strippableSuffix in {"/REPO", "/silverbullet-libraries"} do
    suggestedName = suggestedName:gsub(strippableSuffix .. "$", "")
  end
  -- Strip branch names (@something)
  suggestedName = suggestedName:gsub("@.+$", "")
  -- Take the the last bit
  local parts = suggestedName:split("/")
  return parts[#parts]
end

function reloadEverything()
  mq.awaitEmptyQueue("indexQueue")
  editor.reloadConfigAndCommands()
  codeWidget.refreshAll()
end
```

# Styles
```space-style
table.manage-library td {
  vertical-align: top;
}
table.manage-library thead td:last-child {
  text-align: right;
}

table.manage-library tbody td:last-child {
  text-align: right;
}
```
