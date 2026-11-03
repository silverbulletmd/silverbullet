---
tags: guide
---
Choose a navigation tool based on what you remember: a title, a phrase, a location or a category.

# Choose the right tool
What do you still remember?

* **Part of the page name:** use [[Page Picker]].
* **A phrase inside the page:** use [[Search]]. 
* **Its folder or filename:** use [[File Tree]]. 
* **A page that links to it:** use [[Link]] and [[Linked Mention]].
* **A tag:** use [[Tag Picker]] or picker tag filter.

# Search contents
[[Search]] has **Pages**, **Meta** and **All** segments. Use **All words** when you remember several words anywhere in a page, or **Exact phrase** when their order matters. **Semantic** is available in spaces where meaning-based search has been enabled. Results include excerpts so you can recognize the right page before opening it.

# Give an important passage a stable destination
A heading can be linked with `[[Page#Heading]]`. If a specific paragraph or task needs a durable name, add a unique anchor on the source page:

```markdown
A passage you want to link to. $reference-point
```

Link directly to it with `[[$reference-point]]`, or find it by typing `$reference` in the picker. Anchors must be unique across the space. [[Markdown/Anchor]] owns their complete syntax and scope rules. [[Names]] and [[Link]] explain page naming and link resolution.

# Use folders when they help
`Folder/Page` creates a page under `Folder/` in the tree. A folder gives a page one location. Tags allow multiple categories. Neither is required to write useful pages. If you rename a page, use the page title or supported rename command so SilverBullet can handle incoming links. Renaming files outside SilverBullet needs extra care.
