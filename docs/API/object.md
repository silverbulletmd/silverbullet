---
tags: api/syscall
references:
- plugs/index/object_api.ts
- plugs/index/object_edit.ts
---
Change, delete and create [[Object|objects]] where they are written: page frontmatter, [[Task|tasks]] and list items, paragraphs, [[Tag/data|data blocks]] and [[Tag/table|table rows]]. Use these from buttons and other widgets to build small apps on top of your pages. They edit the page's Markdown, so the change shows up in the page, its history and every query.

Each function takes an object as a query (or `object.append`) returns it. An object without an anchor is found by its position and checked against what you queried, so if its page changed since, the call fails with "object moved" instead of changing the wrong object; query again. Objects with a `$anchor` are found wherever they moved, and can also be passed as `{ page = "…", ref = "anchor-name" }`.

```lua
-- Mark a task done and set an attribute
local t = (query[[from index.tasks() where _.page == "Projects/Harbor" limit 1]])[1]
object.update(t, { done = true, owner = "Ada" })

-- Remove an attribute (Lua tables can't hold nil, hence the option)
object.update(t, {}, { remove = { "owner" } })

-- Add an expense to a data block and change it later
local e = object.append("Trips/Lisbon", { tag = "expense", what = "Tram", amount = 2 }, { anchor = true })
object.update(e, { amount = 3 })
object.delete(e)

-- Create a record page
object.createPage("Contacts/Ada", { tags = "contact", company = "Acme" })
```

| Object | What `object.update` changes | What `object.delete` removes |
| --- | --- | --- |
| page | frontmatter keys | the page |
| task, item | `name` (the text), `done`/`state` (tasks), `tags`, `[key: value]` attributes | the item and its sub-items |
| paragraph | `text`, `tags`, `[key: value]` attributes | the paragraph |
| data block document | top-level YAML keys | the document (the block, if it was the last) |
| table row | cells, by column name (lowercased, other characters as `_`) | the row |

When the object's tag has a schema, a change that would make it invalid fails and nothing is written. On the open page each call is one undoable edit, saved right away.

<!--#lua spacelua.renderApiDocumentation("object") -->
## object.append

`object.append(page, record, options?)`

Adds a task, list item, table row or data block document to a page and returns its { page, ref }.

**Parameters:**

- `page` (`string`) — Page to add to.
- `record` (`table`) — tag = "task", "item", "table" or a data tag, plus its attributes.
- `options?` (`table`) — anchor: true or a name to add a $anchor; under: header to add a task or item under; table: tableref of the table to add a row to.

**Returns:**

- `table` — { page, ref } of the new object.

## object.createPage

`object.createPage(name, attributes?, body?)`

Creates a page with the given frontmatter attributes and body. Fails if the page exists.

**Parameters:**

- `name` (`string`) — Page name.
- `attributes?` (`table`) — Frontmatter attributes.
- `body?` (`string`) — Page text after the frontmatter.

**Returns:**

- `table` — { page, ref } of the new page.

## object.delete

`object.delete(object)`

Removes an object from its page (a list item with its sub-items, a paragraph, a data block document, a table row), or deletes the page for a page object.

**Parameters:**

- `object` (`table`) — An object from a query, or { page = …, ref = … }.

## object.update

`object.update(object, patch, options?)`

Changes attributes of an object (or a list of objects) where it is written in its page: frontmatter for pages, inline [key: value] attributes, hashtags, state and text for tasks and items, YAML keys for data blocks, cells for table rows. Fails if the object moved since it was queried.

**Parameters:**

- `object` (`table`) — An object from a query, a list of them, or { page = …, ref = … }.
- `patch` (`table`) — Attributes to set. For tasks: done, state, name, tags. For paragraphs: text.
- `options?` (`table`) — remove: list of attribute names to delete.
<!--/lua-->
