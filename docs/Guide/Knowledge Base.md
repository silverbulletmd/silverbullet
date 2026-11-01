---
tags: guide
---
Build a knowledge base from useful topic pages and links, then add categories and live overviews as the collection grows.

# Create your first topic pages
Start with a few subjects you want to return to. In the [[Page Picker]] (Cmd-k / Ctrl-k), type a title and press Shift-Enter to open that exact name. Write a paragraph or two. [[Guide/Your First Markdown Page]] uses `Photo Walk`; [[Guide/Find and Connect Pages]] adds `Reading List`.

Keep a page focused enough that its name is useful in a sentence. You can start at the top level and add folders later. [[Guide/Best Practices]] describes the tradeoffs rather than prescribing one hierarchy.

# Link as you write
On `Reading List`, write a connection in ordinary Markdown:

```markdown
These books may inspire [[Photo Walk]].
```

Open `Photo Walk` and look at **Linked Mentions**, normally below the page. It shows the reading-list reference with context. Links you add while writing build discoverable reverse connections without another catalog to maintain. [[Linked Mention]] owns the backlink behavior.

A [[Journal]] is an optional place to capture those connections over time: link daily observations to their subject pages. Topic pages work equally well without a journal.

# Keep source material with your notes
Attach a PDF or other source file using [[Document]], then keep its citation, summary and useful quotations in a page linked to that file. [[Search]] indexes your Markdown notes, not the contents of attachments. Use [[Guide/Find Pages#Give an important passage a stable destination|anchors]] to link to a particular passage in your notes.

# Add structure when useful
When you need categories, use page tags. A paragraph consisting only of `#book` tags the page. If you also need an author or reading status, put frontmatter at the very beginning of each book page:

```markdown
---
tags: book
author: Rob Walker
status: reading
---
Notes on The Art of Noticing.
```

Create that as a separate page named `The Art of Noticing` in your practice space. A `Reading List` bullet naming a book is still a bullet, not a book page. Consistent page tags make similar records easy to find; attributes supply the values you want to compare. [[Frontmatter]], [[Attribute]] and [[Markdown/Hashtags]] retain the detailed syntax and scope rules.

# Query your knowledge
Open `Workbench: Query`, choose `page` with **Content** scope, narrow it to the `book` tag, and filter `status` **is** `reading`. Order by `lastModified` with the latest first. Choose **Select → List → templates.pageItem**. Create a `Currently Reading` page, place your cursor in its body, and use **Insert at cursor**.

The generated query is equivalent to this complete example:

```markdown
${query[[
  from b = index.contentPages("book")
  where b.status == "reading"
  order by b.lastModified desc
  select templates.pageItem(b)
]]}
```

The live result links to the book page. Changing its reading status changes its membership after indexing. See [[Guide/Build Your First Query]] for the full builder workflow, [[Guide/Query Recipes]] for variations, and [[Template]] for rendering options.

# Embed content across pages
On another page, such as your [[Index Page]], insert:

```markdown
![[Currently Reading]]
```

A [[Transclusions|transclusion]] displays the other page’s content without making a separate maintained copy. The query remains defined on `Currently Reading`. A live result and a transclusion render in SilverBullet; [[Baked Sections]] explains how to store computed output when you need portable Markdown.

# What’s next?
* [[Guide/Aggregator Pages]] — build an overview for a whole category.
* [[Guide/Task Management]] — connect action items to their subjects.
* [[Guide/Find Pages]] — navigate a growing space.
* [[Guide/When Results Update]] — understand live versus stored output.
