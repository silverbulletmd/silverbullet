---
tags: api/syscall
references:
- plug-api/syscalls/space.ts
- client/plugos/syscalls/space.ts
- client/spaces/space_primitives.ts
---

The Space API provides functions for interacting with pages, documents, and files in the space.

<!--#lua spacelua.renderApiDocumentation("space") -->
## space.collidingBasenames

`space.collidingBasenames()`

Returns every basename carried by more than one file, with the files carrying it.

## space.createRevisionSnapshot

`space.createRevisionSnapshot()`

Commits everything outstanding as a revision now, rather than waiting for the automatic commit. False if there was nothing to commit.

## space.deleteDocument

`space.deleteDocument(name)`

Deletes a document from the space.

## space.deleteFile

`space.deleteFile(name)`

Deletes an arbitrary file from the space.

## space.deletePage

`space.deletePage(name)`

Deletes a page from the space.

## space.fileExists

`space.fileExists(name)`

Checks whether an arbitrary file exists in the space.

## space.getAttachmentMeta

`space.getAttachmentMeta(name)`

> **Deprecated:** Use space.getDocumentMeta instead.

Deprecated alias for space.getDocumentMeta.

## space.getDocumentMeta

`space.getDocumentMeta(name)`

Returns metadata for a document.

## space.getFileMeta

`space.getFileMeta(name)`

Returns metadata for an arbitrary space file.

## space.getGitConflictVersion

`space.getGitConflictVersion(id, generation, side)`

Downloads one original side of an unresolved Git conflict.

## space.getGitConflicts

`space.getGitConflicts()`

Lists unresolved Git conflicts with saved content versions.

## space.getGitSyncStatus

`space.getGitSyncStatus()`

Reads Git sync status and its last successful check.

## space.getPageMeta

`space.getPageMeta(name)`

Returns metadata for a page.

## space.getRevision

`space.getRevision(path, rev, parent?)`

Reads the text of a file as it was at a given revision, or at that revision's parent.

## space.getRevisionDiff

`space.getRevisionDiff(path, rev?)`

Reads a unified diff of a revision's own change (vs its parent), or of the uncommitted change when no revision is given.

## space.getSpaceLog

`space.getSpaceLog(before?, q?)`

Lists the space-wide commit log. Each commit's `files` — and the `uncommitted` list — are tables of `{path, status}`, where `status` is `added`, `modified`, `deleted` or `renamed`.

## space.lint

`space.lint()`
`space.lint(page)`
`space.lint(pages)`

Lints pages the way the editor does — frontmatter and data block YAML, `space-lua` syntax, object validation against tag schemas, anchors — and also renders each `${...}` directive and Lua code widget, reporting those that fail. Without an argument, lints every page outside `Library/`.

**Parameters:**

- `pages?` — A page name or a list of page names; omit to lint all pages outside `Library/`.

**Returns:**

- `table` — A list of `{page, line, column, severity, message, source}`, ordered by page then position. `line` and `column` are 1-based; `severity` is `error`, `warning`, `info` or `hint`; `source` names what reported it: the linter's own name (`yaml`, `lua`, `objects` and `anchors` for the built-in ones) or else its `editor:lint` listener, `widget` (a failing directive or code widget), or `page` (the page could not be read). `hint` diagnostics, such as the X-Ray lens, are left out.

**Examples:**

```lua
space.lint("Projects/Launch")
```

```lua
for _, d in ipairs(space.lint()) do
  print(d.page .. ":" .. d.line .. ": " .. d.message)
end
```

## space.listAttachments

`space.listAttachments()`

> **Deprecated:** Use space.listDocuments instead.

Deprecated alias for space.listDocuments.

## space.listDocuments

`space.listDocuments()`

Lists all non-page documents in the space.

## space.listFiles

`space.listFiles()`

Lists every file in the space.

## space.listPages

`space.listPages()`

Lists all pages in the space.

## space.listPlugs

`space.listPlugs()`

Lists all plug files in the space.

## space.listRevisions

`space.listRevisions(path, before?)`

Lists the revision history of a file.

## space.lookupPaths

`space.lookupPaths(paths)`

Looks up, for each path, whether it exists exactly and which files share its basename.

## space.pageExists

`space.pageExists(name)`

Checks whether a page exists in the space.

## space.readAttachment

`space.readAttachment(name)`

> **Deprecated:** Use space.readDocument instead.

Deprecated alias for space.readDocument.

## space.readDocument

`space.readDocument(name)`

Reads a document as binary data.

## space.readFile

`space.readFile(name)`

Reads an arbitrary space file as binary data.

## space.readFileWithMeta

`space.readFileWithMeta(name)`

Reads an arbitrary space file together with its metadata.

## space.readPage

`space.readPage(name)`

Reads a page and returns its Markdown text.

## space.readPageWithMeta

`space.readPageWithMeta(name)`

Reads a page and returns both its Markdown text and metadata.

## space.readRef

`space.readRef(ref)`

Reads the text addressed by a page, header, or position reference.

## space.resolveGitConflict

`space.resolveGitConflict(id, generation, contentRevision, action)`

Resolves a Git conflict if the merge and saved content still match.

## space.syncGitNow

`space.syncGitNow()`

Requests sync on the existing Git connection.

## space.writeDocument

`space.writeDocument(name, data)`

Writes binary document data and returns its metadata.

## space.writeFile

`space.writeFile(name, data)`

Writes an arbitrary binary file and returns its metadata.

## space.writePage

`space.writePage(name, text)`

Writes Markdown text to a page and returns its metadata.
<!--/lua-->

