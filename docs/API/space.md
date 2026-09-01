---
tags: api/syscall
references:
- plug-api/syscalls/space.ts
- client/plugos/syscalls/space.ts
- client/spaces/space_primitives.ts
---

The Space API provides functions for interacting with pages, documents, and files in the space.

<!--#lua spacelua.renderApiDocumentation("space") -->
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

