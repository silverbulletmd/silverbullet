---
tags: guide
---
Build a knowledge base from useful topic pages and links, then add categories and live overviews as the collection grows.

# Create topic pages
Start with subjects you want to return to. In the [[Page Picker]] (**Cmd-k / Ctrl-k**), type a title and press **Shift-Enter** to open that exact name. Write enough context that the page makes sense when opened directly.

Keep each page focused enough that its name is useful in a sentence. You can start at the top level and add folders later. [[Guide/Best Practices]] describes the tradeoffs.

# Link as you write
Type `[[` to find and link another page when it is relevant to your text. Follow a link to a page that does not exist yet and write there to create it.

On the destination page, **Linked Mentions** shows incoming references with their surrounding context. These reverse connections let you discover related material without maintaining a separate catalog. [[Linked Mention]] describes the view’s behavior.

A [[Guide/Journal|Journal]] can capture observations over time while linking back to the relevant topic pages.

# Keep sources alongside your writing
Attach a PDF or other source file using [[Document]], then keep its citation, summary and useful quotations in a page linked to that file. [[Search]] indexes Markdown pages, not attachment contents. Use [[Guide/Finding Content#Give an important passage a stable destination|anchors]] to link to a particular passage.

# Add structure when useful
Use page tags to group related pages. Hover at the top of a page without frontmatter and click **add tag**. In the attribute form, add the category you want to use. Expand the form to add attributes when you need values to filter, compare or sort.

Use consistent tags and attribute names for similar pages. A link or list item naming something does not create a structured page for it. Open the linked page and add its attributes there. [[Frontmatter]], [[Attribute]] and [[Markdown/Hashtags]] explain the syntax and scope rules.

# Create an overview
Run **Workbench: Data** and choose `page` with **Content** scope. Narrow the source to a tag, then add filters and sorting for the attributes that matter to the collection. Choose **Select → List → templates.pageItem** for links, or a table to compare attributes.

Create a page for the overview, place the cursor in its body and use **Insert at cursor**. The results update after source pages are saved and indexed. See [[Guide/Aggregator Pages]] for maintaining an overview and [[Workbench/Data]] for the builder controls.

# Reuse content across pages
Insert a [[Transclusions|transclusion]] with `![[Page name]]` to display another page’s content without maintaining a separate copy. This also works for an overview containing a query.

Live queries render in SilverBullet. [[Baked Sections]] explains how to store computed output when you need portable Markdown.
