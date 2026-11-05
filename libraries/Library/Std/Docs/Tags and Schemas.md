---
description: Defining or changing a tag with tag.define, its schema and validation, page decorations, transform (computed attributes) and custom frontmatter or data-block rendering. Read before defining a tag or its schema. Not needed just to tag pages or query tagged objects (Markdown and Querying cover that).
tags: meta/skill
---
Every object in the index (page, task, item, data object) carries tags. Tagging needs no definition: `tags: book` in frontmatter is enough to make `index.pages("book")` work. Define a tag with `tag.define` only to give it a schema, validation, computed attributes, a look, or a custom renderer.

# Where it goes
Put `tag.define` calls in a `space-lua` block on the `CONFIG` page (create it if missing). `CONFIG` loads before pages are indexed, so a `transform` defined there sees every page; one defined elsewhere misses pages indexed before it loads. Avoid names SilverBullet uses for its own objects: `page`, `task`, `item`, `paragraph`, `header`, `link`, `tag`, `data`, `table`, `anchor`, `relation`, `identity`, `document`. You can extend those, but not reuse them for your own kind.

# tag.define fields
All optional except `name`:
* `name`: the tag, without `#`.
* `tagPage`: the page opened when clicking the tag (default `tag:<name>`).
* `schema`: a JSON Schema the tag's objects are checked against. Failures show as lint warnings in the editor.
* `mustValidate`: when `true`, objects failing `schema` or `validate` are not indexed at all (errors go to the log). Default `false`.
* `validate`: `function(o)` returning nil when valid, or an error message.
* `pageDecoration`: a look for every page with the tag: `icon` (a Feather icon name), `prefix`, `cssClasses`, and the other page decoration fields. The page's own `pageDecoration` wins, then the first of its tags that sets a field; `cssClasses` combine. Changing it re-indexes the pages with the tag automatically.
* `transform`: `function(o)` called for each indexed object with the tag. Change `o` and return it; return `{}` to skip indexing it; return `nil` to index it unchanged; or return a list of objects to index instead, one of which keeps the original `ref`.
* `metatable`: a Lua metatable for the tag's objects, e.g. computed attributes through `__index`.
* `renderFrontmatter`: `function(pageMeta, ctx)` returning a widget that replaces the frontmatter of pages with this tag.
* `renderDataBlock`: `function(object, ctx)` returning a widget for each object in a data block fenced as the tag.

Calling `tag.define` again with the same `name` merges the fields, so you can extend built-in tags. Set a field to `config.unset` to remove it.

```lua
tag.define {
  name = "book",
  schema = {
    type = "object",
    properties = {
      author = schema.string(),
      rating = schema.nullable("number"),
      status = schema.enum({"unread", "reading", "read"}),
      finished = schema.date(),
      series = schema.ref("series"),
    },
  },
  pageDecoration = { icon = "book" },
}
```

Without writing Lua, the Workbench's Data tab (`Workbench: Schema`) shows a tag's attributes, creates a schema from the ones its objects use, and edits schemas in place, saving them to a managed block in `CONFIG`.

# Schema helpers
The `schema` table builds JSON Schema values; a plain table such as `{type = "string"}` works too.

| Helper | Accepts |
| --- | --- |
| `schema.string()`, `schema.number()`, `schema.boolean()`, `schema.null()` | That type |
| `schema.array("string")` or `schema.array(s)` | A list of a type name or a schema |
| `schema.nullable(t)`, `schema.nullableArray(t)` | The type (or list of it) or null |
| `schema.enum({"a", "b"})` | One of the listed strings |
| `schema.date()` | A date string |
| `schema.ref("series")` | One quoted wiki link, such as `"[[Series/Dune]]"`, to an object with that tag (tag optional) |
| `schema.tags(extra)`, `schema.identities(extra)` | Tag names or `@names`, as a list or one space-separated string; `extra` adds keys such as `description` |
| `schema.object()`, `schema.func()`, `schema.schema()` | Markers for any object, a function, a schema |

Use `type = "object"` with `properties` at the top, as above. The same helpers describe settings in `config.define(key, schema)`.

# Check the result
After saving `CONFIG`, check that the definition took effect and what it does:

```lua
index.tagSchema("book")
```

```lua
space.lint("Books/Dune")
```

```lua
query[[from b = index.pages("book") limit 3 select b]]
```

`index.tagSchema` returns the schema as loaded (nil when none is declared). `space.lint` lists schema violations on a page with `source` `objects`; run it on a page you expect to be invalid as well as one you expect to pass. The sample query shows attributes added by a `transform`.

An `edit` of `CONFIG` (MCP or `sb`) reloads its scripts and reports load errors, so a typo in `tag.define` shows up in that result. Then `read` a tagged page with `rendered: true` for its lint problems, and take a `screenshot` when the look matters.

# Changing a transform
A `transform` runs only when a page is indexed. A new or changed transform therefore applies to pages as they are next edited, not to the rest. To apply it everywhere, reindex the space: the `Space: Reindex` command, or `index.reindexSpace()` with `lua`. On a large space this takes a while, so tell the user, or ask before doing it. Schema and `validate` changes need no reindex for lint, but `mustValidate` filtering happens at index time.

# Styling a kind of page
To give every page with a tag its own look, style the class instead of decorating each page by hand: attach a CSS class through the tag, then target it from a `space-style` block. Put the `tag.define` in `CONFIG`, for the reason given above.

````markdown
```space-lua
tag.define {
  name = "recipe",
  pageDecoration = { icon = "coffee", cssClasses = { "recipe-page" } },
}
```

```space-style
body.recipe-page #sb-main .cm-editor { border-left: 4px solid var(--tone-accent); }
```
````

The class lands on the page body, on links to the tagged pages and on their picker entries. Prefer the tone colours (`var(--tone-success)`, `warning`, `danger`, `info`, `neutral`, `accent`, each with a `-soft` variant) over fixed colours: they work in light and dark mode. Existing pages pick up a new class after a reindex (see above).

# Rendering and style
`renderFrontmatter` and `renderDataBlock` receive the object with its current values and a context `ctx` with `ctx.values`, `ctx.kind`, `ctx.readOnly` and `ctx.set(key, value)`, `ctx.remove(key)`, `ctx.move(key, delta)` to edit the YAML. For frontmatter, the first tag in the page's `tags` with a renderer wins. Full details and examples are on the `API/tag` page of the SilverBullet documentation (docs.silverbullet.md; edge.silverbullet.md for Edge builds). For CSS classes on tagged pages, icons and widgets, see Building Interfaces.
