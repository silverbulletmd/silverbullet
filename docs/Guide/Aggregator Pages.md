---
tags: guide
---
An aggregator page collects related pages or tasks through a live query. Write the content where it belongs and use the aggregator to find it in one place.

# Choose what to collect
Choose a category and give its members a shared tag. Use the visual frontmatter editor to tag whole pages. Put a tag on a task line to categorize that task. A tag in an ordinary paragraph applies to the paragraph, not the page.

Decide whether the overview should collect pages or tasks before building the query. The same tag can appear on different kinds of objects. See [[Markdown/Hashtags]] for tag scope.

# Build the overview
1. Create a page for the overview and add a short introduction explaining what it collects.
2. Run **Workbench: Data**. Choose `page` or `task` under **Root** and select the tag under **From**. For ordinary pages, use **Content** scope to exclude configuration and library pages.
3. Add filters and an order if needed. Check the preview before narrowing the results further.
4. Choose a list or table under **Select**. For a list, use `templates.pageItem` for pages or `templates.taskItem` for tasks.
5. Put the cursor below the introduction and choose **Insert at cursor**.

Link to the overview from wherever you need it. To adjust its query later, open the result’s ⋯ menu and choose **Edit in query builder**, then use **Update page**.

# Keep the collection current
Adding a matching page or task brings it into the collection after saving and indexing. Removing its tag or changing an attribute used by a filter may remove it. The aggregator does not keep a separate copy of the source content.

If something is missing, check its tag scope and the query’s root, filters and content scope. [[Guide/When Results Update]] explains refresh behavior.

# Open an overview from a tag
You can make a tag open your overview by defining a `tagPage` mapping with [[API/tag#tag.define(spec)]]. Put the definition in [[^Library/Config]] and run **System: Reload**. This is optional. The aggregator works without a custom tag page.

# Keep a portable copy
Live queries render in SilverBullet. Use [[Baked Sections]] if you also need stored Markdown that other tools can display. Update the baked section when you want to refresh that snapshot.

[[Workbench/Data]] documents the builder controls. [[Object Index]] explains the available query sources.
