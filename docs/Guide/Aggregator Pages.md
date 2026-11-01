---
tags: guide
---
An aggregator page collects a category of notes or tasks through a live query, so the source material stays in its natural place.

# The pattern
Pick a category, apply it to the things you want to collect, and create a page containing a query over that category. A collection of outing pages could live on `Outings`; packing tasks could live on `Packing List`. The source kind matters: page queries collect pages, task queries collect tasks.

Start with the `Photo Walk` example from [[Getting Started]]. Its frontmatter tags the page `outing`, while `#packing` on the two task lines tags those tasks. Putting `#outing` in an ordinary paragraph would tag the paragraph, not the page.

# Recipe
1. Create an `Outings` page in your writable practice space. Add a short introduction so the page makes sense even outside SilverBullet.
2. Run `Workbench: Query`. Choose `page` with **Content** scope, narrow it to `outing`, and sort by `name` **A–Z**.
3. Under **Select**, choose **List** and `templates.pageItem`. Put the cursor below the introduction and click **Insert at cursor**.
4. Link to `[[Outings]]` from your index or another place where you would look for the collection.

The complete source is:

```markdown
${query[[
  from p = index.contentPages("outing")
  order by p.name
  select templates.pageItem(p)
]]}
```

Add another page tagged `outing` and it joins the collection after saving and indexing. Removing a page’s tag removes it from the result. The list reflects the current indexed data; it can briefly lag an edit. This avoids separately maintaining the same membership in several places.

For a task collection instead, choose `task`, narrow to `packing`, and select `templates.taskItem`. Use `index.tasks("packing")` in source. `index.contentPages("packing")` would look for packing-tagged pages, not the packing tasks. [[Guide/Query Recipes]] provides complete task examples.

# Optional tag navigation
An aggregator works without configuration. If you also want clicking the tag to open its overview, define a `tagPage` mapping in [[CONFIG]]. Copy the following into a `space-lua` fenced block there; it is displayed here as inert `lua` source:

```lua
tag.define {
  name = "outing",
  tagPage = "Outings",
}
```

Run `System: Reload` to load the definition. Keep `tag.define` calls in `CONFIG` so definitions that affect indexing are available before pages are indexed. If you later add a transform, existing content needs reindexing; see [[Guide/When Results Update]] and [[API/tag#tag.define(spec)]].

# Choosing the source
`index.contentPages("outing")` excludes [[Meta Page|meta pages]], which usually keeps configuration and library notes out of ordinary collections. `index.pages("outing")` includes matching meta pages too. `index.objects("outing")` can return every object kind carrying that tag; do not use it as a synonym for pages. [[Object Index]] describes these helpers.

# Examples in this manual
The documentation uses the same pattern for [[ADR]] (pages tagged `adr`) and [[Architecture]] (pages tagged `component`), with tag navigation registered in [[CONFIG]]. [[Glossary]] is another category overview. Their content belongs to this documentation space; copy the pattern into your own space and choose your own category.

The query renders live in SilverBullet. For a stored portable version, use [[Baked Sections]] and update it explicitly when the source changes.
