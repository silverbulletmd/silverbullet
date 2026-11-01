---
tags: guide
---
Choose a navigation tool based on what you remember: a title, a phrase, a location or a category.

# Choose the right tool
* **Part of the page name:** use [[Page Picker]]. Cmd-k / Ctrl-k, then type `Photo`.
* **A phrase inside the page:** use [[Search]]. Cmd-Shift-f / Ctrl-Shift-f, then search `binoculars`.
* **Its folder or filename:** use [[File Tree]]. Run `Navigate: Tree`, then expand or filter the tree.
* **A page that links to it:** use [[Link]] and [[Linked Mention]]. Follow `Reading List` from `Photo Walk`; inspect Linked Mentions to return.
* **A category:** use [[Tag Picker]] or picker tag filter. Type `#outing` in the page picker after tagging the example page.
* **A named passage:** use [[Markdown/Anchor|Anchor navigation]]. Start the picker input with `$` and type part of an anchor name.

The names in the examples come from [[Getting Started]]. Try them in a writable practice space; they do not need to exist in the documentation.

# Open or create a page deliberately
In the page picker, **Enter** opens the highlighted result. **Shift-Enter** opens the exact name you typed, creating it when it does not exist. Use Shift-Enter when you intend to create `Photo Walk` rather than open a similar existing name. In anchor and tag navigation there is nothing to create.

With no search phrase, the picker orders pages by recent activity. Use the **Meta** segment for configuration and library pages excluded from ordinary page results. [[Page Picker#Keyboard shortcuts]] describes segment switching and keyboard selection; [[Meta Picker]] and [[Anything Picker]] explain the specialized views.

# Search contents
Search has **Pages**, **Meta** and **All** segments. Use **All words** when you remember several words anywhere in a page, or **Exact phrase** when their order matters. **Semantic** is available in spaces where meaning-based search has been enabled. Results include excerpts so you can recognize the right page before opening it. See [[Search#What is searched]] for size limits and excluded content, and [[Search#The search index]] for startup and update behavior.

# Give an important passage a stable destination
A heading can be linked with `[[Photo Walk#Plan]]`. If a specific paragraph or task needs a durable name, add a unique anchor in your practice page:

```markdown
* Meet at the riverside path at 08:00. $walk-meeting-point
```

Link directly to it with `[[$walk-meeting-point]]`, or find it by typing `$walk` in the picker. Anchors must be unique across the space. [[Markdown/Anchor]] owns their complete syntax and scope rules; [[Names]] and [[Link]] explain page naming and link resolution.

# Use folders when they help
`Trips/Photo Walk` creates a page under `Trips/` in the tree. A folder gives a page one location; tags allow multiple categories. Neither is required to write useful pages. If you rename a page, use the page title or supported rename command so SilverBullet can handle incoming links; renaming files outside SilverBullet needs extra care.
