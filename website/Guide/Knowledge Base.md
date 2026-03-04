#guide

This guide walks you through building a personal knowledge base with SilverBullet. You'll learn how pages, links, tags, queries, and transclusions work together to create an interconnected web of knowledge.

# 1. Create your first topic pages
Start with 3–4 pages on topics you know well: a programming language, a recipe, a book you've read. Open the [[Page Picker]] (`Cmd-k` / `Ctrl-k`), type a name, and press Enter.

Keep each page focused on one topic. A page about “Rust” covers Rust. A page about “Ownership” covers ownership. This “atomic note” approach makes pages easy to link and reuse.

Write freely — a paragraph or two is enough to get started.

# 2. Link as you write
As you write on one page, naturally reference another. Type `[[` and SilverBullet autocompletes page names:

```markdown
Rust's [[Ownership]] model prevents data races at compile time.
```

Don’t worry about organizing pages into the “right” folder structure upfront (or at all). Just write and link. The structure emerges from the connections.

# 3. Discover connections via backlinks
Navigate to one of your linked pages (click a `[[link]]` or use the Page Picker). Scroll to the bottom and look for the **Linked Mentions** section.

This shows every page that links _to_ the current page — connections you didn't have to manually create. For example, your “Ownership” page will show that your “Rust” page mentions it.

This is how a knowledge base builds itself: write naturally, link as you go, and let [[Linked Mention|linked mentions]] surface the connections.

# 4. Add structure when it's useful
When you want to categorize or query pages, add some structure.

**Hashtags** on an empty line tag the page (see [[Markdown/Hashtags#Scope rules]]):
```markdown
#concept
```

**[[Frontmatter]]** at the top of a page adds structured data:
```yaml
---
tags: book
author: Italo Calvino
status: reading
---
```

Now this page is tagged `book` and has queryable `author` and `status` attributes. You can add tags to a page either with the `#book` syntax, or via a [[Frontmatter]] attribute.

# 5. Query your knowledge
[[Space Lua/Lua Integrated Query]] lets you pull live data from your pages. Create a “Currently Reading” page with a query:

```lua
${template.each(query[[
  from b = tags.book
  where b.status == "reading"
  order by b.lastModified desc
]], templates.pageItem)}
```

See [[Template]] for more rendering options.

# 6. Embed content across pages
Use [[Transclusions]] to pull content from one page into another. For instance on your [[Index Page]], transclude your “Currently Reading” page:

```markdown
![[Currently Reading]]
```

# What's next?
You now have the core pattern: create pages, link them, add structure with tags and frontmatter, and query across your space.

* [[Guide/Journaling]] — set up a daily journal
* [[Guide/Task Management]] — track projects and tasks
* [[Guide/People Notes]] — keep track of people and conversations
* [[Manual]] — the full user manual
