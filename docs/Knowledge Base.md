---
tags: guide
references:
- libraries/Library/Std/Pages/Space Overview.md
---

This guide walks you through building a personal knowledge base with SilverBullet. You’ll learn how pages, links, tags, queries, and transclusions work together to create an interconnected web of knowledge.

> **note** Note
> This workflow works well with [[Journal]], where you link out to knowledge base topic pages from your journal pages.

# Create your first topic pages
Start with 3–4 “topic pages” on topics you know well: a programming language, a recipe, a book you've read. Open the [[Page Picker]] (`Cmd-k` / `Ctrl-k`), type a name, and press Enter.

Keep each page focused on one topic. A page about “Rust” covers Rust. A page about “Ownership” covers ownership. This topic page approach makes pages easy to link and reuse.

Write freely — a paragraph or two is enough to get started.

# Link as you write
As you write on one page, naturally reference another. Type `[[` and SilverBullet autocompletes page names:

```markdown
Rust's [[Ownership]] model prevents data races at compile time.
```

Don’t worry about organizing pages into a folder structure, just put everything at the top level (see [[Best Practices]]). Just write and link. Structure emerges from connections.

# Discover connections via backlinks
Navigate to one of your linked pages (click a `[[link]]` or use the Page Picker). Scroll to the bottom and look for the [[Linked Mention]] section.

This shows every page that links _to_ the current page — connections you didn't have to manually create. For example, your “Ownership” page will show that your “Rust” page mentions it.

This is how a knowledge base builds itself: write naturally, link as you go, and let linked mentions surface the connections.

# Add structure when useful
When you want to categorize or query pages, add some structure.

[[Markdown/Hashtags]] on an empty line tag the page (see [[Markdown/Hashtags#Scope rules]]):
```markdown
#concept
```

**[[Frontmatter]]** at the top of a page adds structured data and also be used as an alternative way to attach tags to a page:
```yaml
---
tags: book
author: Italo Calvino
status: reading
---
```

Now this page is tagged `book` and has queryable `author` and `status` attributes. You can add tags to a page either with the `#book` syntax, or via a [[Frontmatter]] attribute.

# Query your knowledge
[[Space Lua/Integrated Query]] lets you pull live data from your pages. Create a “Currently Reading” page with a query:

```lua
${query[[
  from b = index.pages("book")
  where b.status == "reading"
  order by b.lastModified desc
  select templates.pageItem(b)
]]}
```

See [[Template]] for more rendering options.

# Embed content across pages
Use [[Transclusions]] to pull content from one page into another. For instance on your [[Index Page]], transclude your “Currently Reading” page:

```markdown
![[Currently Reading]]
```

# What's next?
You now have the core pattern: create pages, link them, add structure with tags and frontmatter, and query across your space.

* [[Journal]] — set up a daily journal
* [[Guide/Task Management]] — track projects and tasks
* [[Manual]] — the full user manual
