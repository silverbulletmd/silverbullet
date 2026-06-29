---
name: Library/Code Link
tags: meta/library
references:
- docs/Library/Code Link.md
---
Code Link connects documentation pages to the source files they explain. Pages can add a `references:` frontmatter list of repo-relative source files or Git path globs, and this library can then report source drift, unresolved references, and reverse lookups.

# Prerequisites
Code Link assumes a local, Git-backed SilverBullet space:

* The _Shell API_ must be enabled for at least the `git` command, because Code Link shells out to Git for tracked-file checks, commit timestamps, and submodule discovery.
* The configured `codeLink.repoRoot` must point at a Git working tree, relative to the space path. Submodules are supported, but the root still needs to be discoverable by `git rev-parse --show-toplevel`.
* Referenced source files should be tracked by Git. Untracked, ignored, generated, or misspelled files are reported as broken code links.
* Wildcard references use Git pathspec globs such as `client/space_lua/*` or `client/**/*.ts`. A wildcard is considered healthy when it matches at least one tracked file.
* Drift detection uses Git commit timestamps, not filesystem modification times. Local uncommitted code changes are therefore not considered drift until committed.

# Configuration
This library registers a **Code Link** section in the _Configuration Manager_:

* `codeLink.repoRoot`: Git repository root used to resolve source references, relative to the space root. Defaults to `..`.
* `codeLink.docsPrefix`: Optional path prefix override for documentation pages inside the repository. When unset, the prefix is derived from the space root path relative to `codeLink.repoRoot`.

# Public API
The supported `codeLink.*` functions are:

* `codeLink.references(page)`: returns the valid string entries from a page's `references` list.
* `codeLink.pagesForPath(path)`: returns pages that reference `path`, including through matching wildcard references.
* `codeLink.pageDrift(page)`: returns drift information for one page, or `nil` when it is current.
* `codeLink.referenceDrift()`: returns all pages whose referenced source files changed after the page was last updated or reviewed.
* `codeLink.healthMarkdown()`: returns a Markdown summary of `codeLink.referenceDrift()`.
* `codeLink.referenceErrors()`: returns unresolved `references:` entries.
* `codeLink.referenceErrorsMarkdown()`: returns a Markdown summary of `codeLink.referenceErrors()`.
* `codeLink.confirmReview(pageName?)`: sets `lastReviewed` to today for `pageName`, or for the current page when omitted.

# Suggested Health Page Setup
For a space-wide docs maintenance page, add sections like these to your `Health` page:

```markdown
# Code drift
Pages whose referenced source files changed after the page was last updated or reviewed:

${codeLink.healthMarkdown()}

# Broken code links
`references:` entries that do not currently resolve to tracked source files:

${codeLink.referenceErrorsMarkdown()}
```

The drift section is the review queue: when a page appears there, open the page, compare it with the referenced code, and use the page's **Confirm review** widget when the docs still match the code. That updates `lastReviewed`, which dismisses the item until the referenced files change again.

The broken code links section is the reference cleanup queue. Those items usually mean a file was renamed, deleted, left untracked, or the `references:` path was misspelled.

# Setup and Schema
This block initializes the library namespace, registers Configuration Manager settings, and extends the built-in `page` tag schema with `references` and `lastReviewed`.

```space-lua
-- priority: 10
codeLink = codeLink or {}
codeLinkInternal = {}

config.defineCategory {
  name = "Code Link",
  description = "Configure Code Link maintenance helpers.",
  priority = 35,
}

config.define("codeLink", {
  type = "object",
  properties = {
    repoRoot = {
      type = "string",
      default = "..",
      description = "Git repository root used to resolve source references, relative to the space root.",
      ui = { category = "Code Link", label = "Git repository root", priority = 2 },
    },
    docsPrefix = {
      type = "string",
      description = "Optional path prefix override for documentation pages inside the repository. Leave empty to derive it from the space root path.",
      ui = { category = "Code Link", label = "Documentation path prefix override", priority = 1 },
    },
  },
  additionalProperties = false,
})

tag.define {
  name = "page",
  schema = {
    type = "object",
    properties = {
      references = schema.array("string"),
      lastReviewed = schema.string(),
    },
  },
}
```

# Reference Metadata
This block defines the small public helper for reading `references:` from page objects. It intentionally accepts only non-empty strings, so malformed frontmatter does not leak into Git lookups.

```space-lua
-- priority: 10
codeLink = codeLink or {}

function codeLink.references(page)
  if not page or not page.references then return {} end
  if type(page.references) ~= "table" then return {} end
  local refs = {}
  for _, ref in ipairs(page.references) do
    if type(ref) == "string" and ref ~= "" then
      table.insert(refs, ref)
    end
  end
  return refs
end
```

# Git and Path Resolution
This block contains the internal Git plumbing. It derives the documentation page prefix from the space root when possible, resolves paths to their owning Git repository, supports submodules, and batches Git calls per repository while preserving the original `references:` strings as public display keys.

```space-lua
-- priority: 10
codeLink = codeLink or {}
codeLinkInternal = codeLinkInternal or {}
codeLinkInternal.gitContextCache = {}
codeLinkInternal.docsSpaceRoot = nil

local function repoRoot()
  return config.get("codeLink.repoRoot", "..")
end

local function stripTrailingSlash(path)
  return string.gsub(path, "/+$", "")
end

local function git(args)
  local gitArgs = {"-C", repoRoot()}
  for _, arg in ipairs(args) do
    table.insert(gitArgs, arg)
  end
  return shell.run("git", gitArgs)
end

local function gitIn(root, args)
  local gitArgs = {"-C", root}
  for _, arg in ipairs(args) do
    table.insert(gitArgs, arg)
  end
  return shell.run("git", gitArgs)
end

local function spaceRoot()
  if codeLinkInternal.docsSpaceRoot then return codeLinkInternal.docsSpaceRoot end
  local result = shell.run("sh", {"-c", "pwd"})
  if result.code ~= 0 then return nil end
  codeLinkInternal.docsSpaceRoot = stripTrailingSlash(string.trim(result.stdout or ""))
  if codeLinkInternal.docsSpaceRoot == "" then return nil end
  return codeLinkInternal.docsSpaceRoot
end

local function relativeChildPath(child, parent)
  child = stripTrailingSlash(child)
  parent = stripTrailingSlash(parent)
  if child == parent then return "" end
  if string.sub(child, 1, #parent + 1) == parent .. "/" then
    return string.sub(child, #parent + 2)
  end
  return nil
end

local function pathStartsWith(path, prefix)
  return path == prefix or string.sub(path, 1, #prefix + 1) == prefix .. "/"
end

local function joinPath(root, path)
  if path == "" then return root end
  return root .. "/" .. path
end

function codeLinkInternal.isGlob(path)
  return string.find(path, "*", 1, true) ~= nil
    or string.find(path, "?", 1, true) ~= nil
end

function codeLinkInternal.globToPattern(glob)
  local globstar = "__CODELINK_GLOBSTAR__"
  local pattern = string.gsub(glob, "([%^%$%(%)%%%.%+%-%[%]])", "%%%1")
  pattern = string.gsub(pattern, "%*%*", globstar)
  pattern = string.gsub(pattern, "%*", "[^/]*")
  pattern = string.gsub(pattern, "%?", "[^/]")
  pattern = string.gsub(pattern, globstar, ".*")
  return "^" .. pattern .. "$"
end

local function gitPathspec(path)
  if codeLinkInternal.isGlob(path) then return ":(glob)" .. path end
  return path
end

local function gitContext()
  local configuredRoot = repoRoot()
  local cached = codeLinkInternal.gitContextCache[configuredRoot]
  if cached ~= nil then
    if cached == false then return nil end
    return cached
  end

  local rootResult = git({"rev-parse", "--show-toplevel"})
  if rootResult.code ~= 0 then
    codeLinkInternal.gitContextCache[configuredRoot] = false
    return nil
  end
  local root = string.trim(rootResult.stdout or "")
  if root == "" then
    codeLinkInternal.gitContextCache[configuredRoot] = false
    return nil
  end

  local submodules = {}
  local submoduleResult = git({"submodule", "status", "--recursive"})
  if submoduleResult.code == 0 then
    for line in string.gmatch(submoduleResult.stdout or "", "[^\r\n]+") do
      local path = string.match(line, "^.?[%x]+%s+([^%s]+)")
      if path then
        table.insert(submodules, {
          path = path,
          repoRoot = joinPath(root, path),
        })
      end
    end
  end

  table.sort(submodules, function(a, b) return #a.path > #b.path end)

  cached = { root = root, submodules = submodules }
  codeLinkInternal.gitContextCache[configuredRoot] = cached
  return cached
end

local function docsPrefix()
  local configured = config.get("codeLink.docsPrefix", nil)
  if configured and configured ~= "" then return configured end

  local context = gitContext()
  local root = spaceRoot()
  if not context or not root then return "docs/" end

  local prefix = relativeChildPath(root, context.root)
  if not prefix then return "docs/" end
  if prefix == "" then return "" end
  return prefix .. "/"
end

local function resolveGitPath(path)
  local context = gitContext()
  if not context then return nil end

  for _, submodule in ipairs(context.submodules) do
    if pathStartsWith(path, submodule.path) then
      local repoPath = string.sub(path, #submodule.path + 2)
      if repoPath ~= "" then
        return {
          displayPath = path,
          repoRoot = submodule.repoRoot,
          repoPath = repoPath,
          displayPrefix = submodule.path .. "/",
        }
      end
    end
  end

  return {
    displayPath = path,
    repoRoot = context.root,
    repoPath = path,
    displayPrefix = "",
  }
end

local function groupGitPaths(paths)
  if not gitContext() then return nil end

  local groups = {}
  local order = {}
  local unresolved = {}
  local seen = {}

  for _, path in ipairs(paths) do
    if not seen[path] then
      seen[path] = true
      local resolved = resolveGitPath(path)
      if resolved then
        local group = groups[resolved.repoRoot]
        if not group then
          group = { repoRoot = resolved.repoRoot, paths = {} }
          groups[resolved.repoRoot] = group
          table.insert(order, group)
        end
        table.insert(group.paths, resolved)
      else
        unresolved[path] = true
      end
    end
  end

  return order, unresolved
end

function codeLinkInternal.pagePath(page)
  return docsPrefix() .. page.name .. ".md"
end

function codeLinkInternal.collectReferencePages()
  local pages = {}
  local paths = {}
  local seen = {}
  for _, page in ipairs(query[[from p = index.contentPages() where p.references order by p.name select p]]) do
    table.insert(pages, page)
    local path = codeLinkInternal.pagePath(page)
    if not seen[path] then
      seen[path] = true
      table.insert(paths, path)
    end
    for _, ref in ipairs(codeLink.references(page)) do
      if not seen[ref] then
        seen[ref] = true
        table.insert(paths, ref)
      end
    end
  end
  return pages, paths
end

function codeLinkInternal.expandPaths(paths)
  if #paths == 0 then return {} end
  local groups = groupGitPaths(paths)
  if not groups then return nil end
  local expanded = {}
  for _, group in ipairs(groups) do
    local args = {"ls-files", "--"}
    local exact = {}
    local globs = {}
    for _, path in ipairs(group.paths) do
      table.insert(args, gitPathspec(path.repoPath))
      if codeLinkInternal.isGlob(path.repoPath) then
        table.insert(globs, {
          displayPath = path.displayPath,
          displayPrefix = path.displayPrefix,
          pattern = codeLinkInternal.globToPattern(path.repoPath),
        })
      else
        exact[path.repoPath] = path.displayPath
      end
    end
    local result = gitIn(group.repoRoot, args)
    if result.code ~= 0 then return nil end
    for line in string.gmatch(result.stdout or "", "[^\r\n]+") do
      local displayPath = exact[line]
      if displayPath then
        expanded[displayPath] = {displayPath}
      end
      for _, glob in ipairs(globs) do
        if string.match(line, glob.pattern) then
          local matches = expanded[glob.displayPath]
          if not matches then
            matches = {}
            expanded[glob.displayPath] = matches
          end
          table.insert(matches, glob.displayPrefix .. line)
        end
      end
    end
  end
  return expanded
end

function codeLinkInternal.expandedPathsList(expanded)
  local paths = {}
  local seen = {}
  for _, matches in pairs(expanded) do
    for _, path in ipairs(matches) do
      if not seen[path] then
        seen[path] = true
        table.insert(paths, path)
      end
    end
  end
  return paths
end

function codeLinkInternal.referenceMatchesPath(ref, path)
  if ref == path then return true end
  if not codeLinkInternal.isGlob(ref) then return false end
  return string.match(path, codeLinkInternal.globToPattern(ref)) ~= nil
end

function codeLinkInternal.gitTrackedPaths(paths)
  local expanded = codeLinkInternal.expandPaths(paths)
  if not expanded then return nil end
  local tracked = {}
  for path, matches in pairs(expanded) do
    tracked[path] = #matches > 0
  end
  return tracked
end

function codeLinkInternal.gitTimes(paths)
  if #paths == 0 then return {} end
  local groups = groupGitPaths(paths)
  if not groups then return nil end
  local times = {}
  for _, group in ipairs(groups) do
    local args = {"log", "--format=%cI", "--name-only", "--"}
    local byRepoPath = {}
    for _, path in ipairs(group.paths) do
      table.insert(args, path.repoPath)
      byRepoPath[path.repoPath] = path.displayPath
    end
    local result = gitIn(group.repoRoot, args)
    if result.code ~= 0 then return nil end
    local currentTime = nil
    for line in string.gmatch(result.stdout or "", "[^\r\n]+") do
      local trimmed = string.trim(line)
      if trimmed ~= "" then
        if string.match(trimmed, "^%d%d%d%d%-%d%d%-%d%dT") then
          currentTime = trimmed
        elseif currentTime then
          local displayPath = byRepoPath[trimmed]
          if displayPath and not times[displayPath] then
            times[displayPath] = currentTime
          end
        end
      end
    end
  end
  return times
end
```

# Review Workflow
This block implements the review-confirmation action. The command updates `lastReviewed` in frontmatter via `index.patchFrontmatter`, so it can add or replace the key without hand-editing YAML.

```space-lua
-- priority: 10
codeLink = codeLink or {}

local function today()
  return os.date("%Y-%m-%d")
end

local function patchLastReviewed(text, date)
  return index.patchFrontmatter(text, {
    {op = "set-key", path = "lastReviewed", value = date or today()},
  })
end

function codeLink.confirmReview(pageName)
  pageName = pageName or editor.getCurrentPage()
  local text = space.readPage(pageName)
  space.writePage(pageName, patchLastReviewed(text, today()))
  editor.flashNotification("Marked " .. pageName .. " reviewed")
end

command.define {
  name = "Code Link: Confirm Review",
  run = function(args)
    local pageName = nil
    if type(args) == "table" then pageName = args[1] end
    codeLink.confirmReview(pageName)
  end
}
```

# Drift Detection
This block compares documentation pages with the Git timestamps of their referenced source files. When `lastReviewed` is present, that date becomes the baseline; otherwise the documentation page's own Git timestamp is used.

```space-lua
-- priority: 10
codeLink = codeLink or {}
codeLinkInternal = codeLinkInternal or {}

local function referenceIsNewer(refTime, page, pageTime)
  if page.lastReviewed then
    return string.sub(refTime, 1, 10) > page.lastReviewed
  end
  return pageTime and refTime > pageTime
end

local function driftItem(page, times, expanded)
  local pageTime = times[codeLinkInternal.pagePath(page)]
  if not pageTime then return nil end

  local changed = {}
  for _, ref in ipairs(codeLink.references(page)) do
    for _, path in ipairs(expanded[ref] or {}) do
      local refTime = times[path]
      if refTime and referenceIsNewer(refTime, page, pageTime) then
        table.insert(changed, { path = path, time = refTime })
      end
    end
  end

  if #changed == 0 then return nil end

  table.sort(changed, function(a, b) return a.time > b.time end)
  return {
    page = page.name,
    pageTime = pageTime,
    newestPath = changed[1].path,
    newestTime = changed[1].time,
    changed = changed,
  }
end

function codeLink.pageDrift(page)
  local refs = codeLink.references(page)
  if #refs == 0 then return nil end

  local paths = {codeLinkInternal.pagePath(page)}
  for _, ref in ipairs(refs) do
    table.insert(paths, ref)
  end

  local expanded = codeLinkInternal.expandPaths(paths)
  if not expanded then error("Unable to list git-tracked paths") end
  local times = codeLinkInternal.gitTimes(codeLinkInternal.expandedPathsList(expanded))
  if not times then error("Unable to read git timestamps") end
  return driftItem(page, times, expanded)
end

function codeLink.referenceDrift()
  local pages, paths = codeLinkInternal.collectReferencePages()
  local expanded = codeLinkInternal.expandPaths(paths)
  if not expanded then error("Unable to list git-tracked paths") end
  local times = codeLinkInternal.gitTimes(codeLinkInternal.expandedPathsList(expanded))
  if not times then error("Unable to read git timestamps") end
  local drift = {}
  for _, page in ipairs(pages) do
    local item = driftItem(page, times, expanded)
    if item then table.insert(drift, item) end
  end
  table.sort(drift, function(a, b) return a.newestTime > b.newestTime end)
  return drift
end

function codeLink.healthMarkdown()
  local ok, drift = pcall(codeLink.referenceDrift)
  if not ok then
    return "_Source drift checks require local shell and git access._"
  end
  if #drift == 0 then
    return "_No referenced source files are newer than their documentation pages._"
  end
  local lines = {}
  for _, item in ipairs(drift) do
    local extra = ""
    if #item.changed > 1 then
      extra = " and " .. tostring(#item.changed - 1) .. " more"
    end
    table.insert(lines, "* [[" .. item.page .. "]] -> `" .. item.newestPath .. "`" .. extra)
  end
  return table.concat(lines, "\n")
end
```

# Reference Reports
This block provides reverse lookups and reference validation. It reports unresolved `references:` entries using Git's tracked-file view, which keeps generated, ignored, or misspelled paths out of the healthy set.

```space-lua
-- priority: 10
codeLink = codeLink or {}
codeLinkInternal = codeLinkInternal or {}

function codeLink.pagesForPath(path)
  local pages = {}
  for _, page in ipairs(query[[from p = index.contentPages() where p.references select p]]) do
    for _, ref in ipairs(codeLink.references(page)) do
      if codeLinkInternal.referenceMatchesPath(ref, path) then
        table.insert(pages, page)
        break
      end
    end
  end
  return pages
end

function codeLink.referenceErrors()
  local pages, paths = codeLinkInternal.collectReferencePages()
  local tracked = codeLinkInternal.gitTrackedPaths(paths)
  if not tracked then error("Unable to list git-tracked paths") end
  local errors = {}
  for _, page in ipairs(pages) do
    for _, ref in ipairs(codeLink.references(page)) do
      if not tracked[ref] then
        table.insert(errors, { page = page.name, reference = ref })
      end
    end
  end
  return errors
end

function codeLink.referenceErrorsMarkdown()
  local ok, errors = pcall(codeLink.referenceErrors)
  if not ok then
    return "_Reference checks require local shell and git access._"
  end
  if #errors == 0 then
    return "_All documented source references resolve._"
  end
  local lines = {}
  for _, err in ipairs(errors) do
    table.insert(lines, "* [[" .. err.page .. "]] -> `" .. err.reference .. "`")
  end
  return table.concat(lines, "\n")
end
```

# Review Widget
This block adds a top-of-page widget that appears only when the current page has source drift. It keeps the health report as a plain list while giving readers a page-local way to confirm that the docs were reviewed.

```space-lua
-- priority: -1
codeLink = codeLink or {}

local function reviewWidget(page)
  local ok, item = pcall(codeLink.pageDrift, page)
  if not ok or not item then return widget.new{} end

  local detail = item.newestPath
  if #item.changed > 1 then
    detail = detail .. " and " .. tostring(#item.changed - 1) .. " more"
  end

  return widget.new {
    html = dom.div {
      class = "code-link-review-widget",
      dom.div {
        class = "code-link-review-widget-main",
        dom.strong { "Referenced source changed" },
        dom.span { "Review this page against ", dom.code { detail }, "." },
      },
      dom.button {
        onclick = function()
          editor.invokeCommand("Code Link: Confirm Review", {page.name})
        end,
        "Confirm review",
      },
    },
    display = "block",
  }
end

event.listen {
  name = "hooks:renderTopWidgets",
  run = function(e)
    local page = editor.getCurrentPageMeta()
    if not page then return end
    return reviewWidget(page)
  end
}
```

# Styling
This style block gives the review widget a compact top-of-page treatment using the existing editor widget background color.

```space-style
.code-link-review-widget {
  align-items: center;
  background: var(--editor-widget-background-color);
  border-left: 4px solid currentColor;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin: 0 !important;
  padding: 10px 12px;
}

.code-link-review-widget-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
```
