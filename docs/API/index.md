---
tags: api/syscall
references:
- plug-api/syscalls/index.ts
- client/plugos/syscalls/index.ts
- client/data/object_index.ts
---

The `index` API provides functions for interacting with SilverBullet's [[Object Index]], including query collections used by [[Space Lua/Integrated Query]], schema introspection, ad-hoc Markdown indexing, and direct object-index operations.

The main query API is `index.objects`; the other collection functions are mostly convenient filters over the same index.

<!--#lua spacelua.renderApiDocumentation("index") -->
## index.aggregates

`index.aggregates()`

Returns stored aggregate records as a query collection.

## index.aspiringPages

`index.aspiringPages()`

Returns linked but not yet created pages as a query collection.

## index.isAvailable

`index.isAvailable()`

Whether a full indexing pass has ever completed for this space. False on a fresh client, and for as long as the first index takes on a large one: every object query answers with whatever has been indexed so far, which is nothing to begin with. Code that must work in that window reads the space directly instead.

**Returns:** `boolean` — Whether the index can be trusted.

## index.contentPages

`index.contentPages(tagName?)`

Returns non-meta pages, optionally filtered by an additional tag, as a query collection.

## index.defineTag

`index.defineTag(tagDefinition)`

Defines or updates a tag and its Lua metatable.

## index.deleteObject

`index.deleteObject(page, tag, ref)`

Deletes an indexed object identified by page, tag, and reference.

## index.describeSchema

`index.describeSchema()`

Returns raw JSON Schemas for every configured tag that declares one.

## index.documents

`index.documents()`

Returns all indexed documents as a query collection.

## index.ensureFullIndex

`index.ensureFullIndex()`

Ensures the complete object index is available and current.

## index.extractFrontmatter

`index.extractFrontmatter(text, options?)`

Extracts and optionally transforms frontmatter and top-level tags in Markdown text.

**Parameters:**

- `text` (`string`) — Markdown text to inspect.
- `options?` (`table`) — Optional frontmatter and tag removal settings.

**Returns:**

- `table` — Parsed frontmatter and the optionally transformed text.

## index.getObjectByRef

`index.getObjectByRef(page, tag, ref)`

Returns an indexed object identified by page, tag, and reference.

## index.headers

`index.headers(tagName?)`

Returns all headers, optionally filtered by an additional tag, as a query collection.

## index.indexObjects

`index.indexObjects(page, objects)`

Indexes a collection of objects for a page.

## index.items

`index.items(tagName?)`

Returns all list items, optionally filtered by an additional tag, as a query collection.

## index.links

`index.links()`

Returns all indexed links as a query collection.

## index.markdown

`index.markdown(text, pageMeta?)`

Indexes Markdown text in memory and returns the objects extracted from it.

**Parameters:**

- `text` (`string`) — Markdown text to index.
- `pageMeta?` (`table`) — Optional page metadata used during indexing.

**Returns:**

- `table` — Objects extracted from the Markdown text.

## index.metaPages

`index.metaPages()`

Returns all meta pages as a query collection.

## index.objects

`index.objects(tagName)`

Returns objects carrying a tag as a query collection.

## index.pages

`index.pages(tagName?)`

Returns all pages, optionally filtered by an additional tag, as a query collection.

## index.paragraphs

`index.paragraphs(tagName?)`

Returns indexed paragraphs, optionally filtered by an additional tag, as a query collection.

## index.patchFrontmatter

`index.patchFrontmatter(text, patch)`

Applies a table of updates to the frontmatter in Markdown text.

**Parameters:**

- `text` (`string`) — Markdown text to update.
- `patch` (`table`) — Frontmatter keys and values to merge.

**Returns:**

- `string` — Markdown text with updated frontmatter.

## index.previewProcessedObjects

`index.previewProcessedObjects(page, objects)`

Runs the indexing pipeline without writing and returns processed tag/object pairs.

## index.queryLuaObjects

`index.queryLuaObjects(tag, query, scopedVariables?)`

Executes a structured Lua collection query against indexed objects.

## index.reindexSpace

`index.reindexSpace()`

Rebuilds the object index for the entire space.

## index.relations

`index.relations(kind?)`

Returns all indexed relations, optionally filtered by kind, as a query collection.

## index.resolveAnchor

`index.resolveAnchor(name, page?)`

Resolves a named anchor to its host page, tag, and source range.

**Parameters:**

- `name` (`string`) — Anchor name without the leading dollar sign.
- `page?` (`string`) — Optional page to restrict the lookup to.

**Returns:**

- `table` — Resolution result including success or missing/duplicate reason.

## index.subPages

`index.subPages(pageName)`

Returns pages nested below a page name as a query collection.

## index.tables

`index.tables(tagName?)`

Returns indexed table rows, optionally filtered by an additional tag, as a query collection.

## index.tag

`index.tag(tagName)`

Returns objects carrying a tag as a query collection.

## index.tagSchema

`index.tagSchema(tagName)`

Returns the raw JSON Schema for a tag, or nil when none is declared.

## index.tags

`index.tags()`

Returns all indexed tag objects as a query collection.

## index.tasks

`index.tasks(tagName?)`

Returns all tasks, optionally filtered by an additional tag, as a query collection.

## index.validateObjects

`index.validateObjects(page, objects)`

Validates objects for a page and returns the first validation error, if any.
<!--/lua-->

## Integrated Query examples

Query one page:

${query[[from index.pages() limit 1]]}

Query three sub-pages below the API page:

<!--#lua query[[from p = index.subPages("API") limit 3 select p.name]] -->
API/asset
API/clientStore
API/codeWidget
<!--/lua-->

Render three incomplete tasks:

<!--#lua query[[from t = index.tasks() where not t.done limit 3 select templates.taskItem(t)]] -->
* [ ] [[Outline Stress Test@1458]] A task as ordered's child
* [ ] [[Outline Stress Test@1559]] Task inside ordered child and now what will happen when this starts to wrap. Oh it looks nice!
* [ ] [[Attribute@1612]] Task with an attribute, I’m so cool
<!--/lua-->

Ad-hoc index a Markdown fragment and select its list items:

${query[[
  from index.markdown("* Item 1\n* [ ] Task 1")
  where _.tag == "item"
]]}

`index.extractFrontmatter` can inspect and optionally transform frontmatter and top-level tags. For example, this returns the frontmatter of the current page:

${(index.extractFrontmatter(editor.getText())).frontmatter}

