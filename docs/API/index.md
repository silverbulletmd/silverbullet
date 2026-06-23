#api/syscall

The `index` API provides convient functions for interacting with SilverBullet's [[Object Index]], allowing you to query indexed data.

# Query collection APIs
(to be used with [[Space Lua/Integrated Query]])

The main API here is `index.objects`, the rest are mostly convenience wrappers around it.

## index.objects(tag)
Returns all objects carrying `tag` as a tag as a query collection.

Example:
${query[[from index.objects("page") limit 1]]}

## index.pages(tag?)
Returns all [[Object/page]]s as a query collection. Optionally filtered `tag`.

Example:
${query[[from index.pages() limit 1]]}

## index.subPages(pageName)
Returns all sub-pages of `pageName` (pages whose name starts with `${pageName}/`) as a query collection.

Example:
${query[[from p = index.subPages("API") limit 3 select p.name]]}

## index.contentPages(tag?)
Returns all content [[Object/page]]s (all pages excluding [[Meta Page|Meta Pages]]) as a query collection. Optionally filtered by an additional `tag`.

Example:
${query[[from index.contentPages() limit 1]]}

## index.metaPages()
Returns all [[Meta Page|Meta Pages]] as a query collection.

Example:
${query[[from index.metaPages() limit 1]]}

## index.aspiringPages()
Returns all [[Object/aspiring-page]]s (pages that are linked to but not yet created) as a query collection.

Example:
${query[[from index.aspiringPages() limit 3]]}

## index.tasks(tag?)
Returns [[Object/task]] as a query collection. Optionally filtered by an additional `tag`.

Example:
${query[[from t = index.tasks() where not t.done limit 3 select templates.taskItem(t)]]}

## index.headers(tag?)
Returns all [[Object/header]]s in your space as a query collection. Optionally filtered by an additional `tag`.

Example:
${query[[from index.headers() limit 3]]}

## index.items(tag?)
Returns all [[Object/item]]s as a query collection. Optionally filtered by an additional `tag`.

Example:
${query[[from index.items() limit 3]]}

## index.paragraphs(tag?)
Returns all indexed [[Object/paragraph]]s as a query collection (note that by default only tagged paragraphs are indexed). Optionally filtered by an additional `tag`.

Example:
${query[[from index.paragraphs() limit 3]]}

## index.tables(tag?)
Returns all [[Object/table]] rows as a query collection. Optionally filtered by an additional `tag`.

Example:
${query[[from index.tables() limit 3]]}

## index.documents()
Returns all [[Object/document]]s as a query collection.

Example:
${query[[from index.documents() limit 3]]}

## index.links()
Returns all [[Object/link]]s as a query collection.

Example:
${query[[from index.links() limit 3]]}

## index.tags()
Returns all [[Object/tag]] objects as a query collection.

Example:
${query[[from index.tags() limit 3]]}

# Indexing APIs
## index.markdown(text, pageMeta?)
Ad-hoc indexes `text` (represented as a markdown string) in memory, and returns all objects found there for further query. When no `pageMeta` is supplied dummy (empty) values will be used.

Example:
${query[[
  from index.markdown("* Item 1\n* [ ] Task 1")
  where _.tag == "item"
]]}

## index.indexObjects(page, objects)
Indexes an array of objects for a specific page and stores it in the data store.

Example:
```lua
local objects = {
    {tag = "mytask", ref="task1", content = "Buy groceries"},
    {tag = "mytask", ref="task2", content = "Write docs"}
}
index.indexObjects("my page", objects)
```

## index.queryLuaObjects(tag, query, scopedVariables?)
Queries objects using a Lua-based collection query.

Example:
```lua
local tasks = index.queryLuaObjects("mytask", {limit=3})
```

## index.getObjectByRef(page, tag, ref)
Retrieves a specific object by its reference.

Example:
```lua
local task = index.getObjectByRef("my page", "mytask", "task1")
if task then
    print("Found task: " .. task.content)
end
```

## index.extractFrontmatter(text, extractOptions)
Extracts frontmatter from a markdown document (whose text is provided as argument), possibly cleaning it up. It also parses top-level tags consistent with SilverBullet's tag indexing system.

It returns a table with two keys:
- `frontmatter`: A table containing the parsed frontmatter.
- `text`: The text of the document, with any changes applied requested with the `extractOptions`.

The `extractOptions` is an optional table that can contain the following keys (which will affect the returned `text`):
- `removeKeys`: An array of keys to remove from the frontmatter.
- `removeTags`: A boolean or array of tags to remove from the frontmatter.
- `removeTagsPrefix`: An array of hierarchical tag prefixes whose body hashtag occurrences should be removed. A tag matches a prefix if it equals the prefix or starts with `${prefix}/`. For example, `{"meta/template"}` removes `#meta/template`, `#meta/template/page` and `#meta/template/slash`.
- `removeFrontMatterSection`: A boolean to remove the frontmatter section from the document.

Example applied to this page:
${(index.extractFrontmatter(editor.getText())).frontmatter}
