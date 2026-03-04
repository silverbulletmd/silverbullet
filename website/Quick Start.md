#getting-started

Welcome! This guide gets you from zero to productive with SilverBullet in about five minutes.

# 1. Install and run
The fastest way to get started is with Docker:

```shell
docker run -p 3000:3000 -v ./space:/space ghcr.io/silverbulletmd/silverbullet
```

Or download the [[Install/Binary|single binary]] and run it:

```shell
silverbullet ./space
```

Now open http://localhost:3000 in your browser.

> **note** Tip
> For a full breakdown of installation options, see [[Install]].

# 2. Create your first page
Click the page icon in the [[Top Bar]] (or press `Cmd-k` / `Ctrl-k`) to open the [[Page Picker]]. Type a page name like "My First Page" and press Enter — SilverBullet creates it instantly.

Start typing. Everything is [[Markdown]].

# 3. Link pages together
Type `[[` to link to another page. SilverBullet autocompletes page names for you. Links are bi-directional: the linked page will show a [[Linked Mention]] back to the page you're writing.

# 4. Add some structure
Tag a page by adding a hashtag on an empty line (see [[Markdown/Hashtags#Scope rules]]), for instance `#project`. Or add structured data using [[Frontmatter]] at the top of a page:

```yaml
---
status: active
priority: high
tags: project
---
```

These attributes become queryable, which we’re going to do next.

# 5. Run your first queries
Pages in SilverBullet can use [[Space Lua]] and [[Space Lua/Lua Integrated Query]] feature specifically to dynamically generate content. Add this to any page:

```lua
${query[[from tags.page limit 5]]}
```

As you move your mouse cursor outside this code fragment, it renders a live table of your pages, right inline. Queries update as your space changes dynamically.

Now, let’s write a query that finds all your pages tagged with `#project` (as done in the previous step) filtered on only high priority ones:

```lua
${query[[from p = tags.project where p.priority == "high"]]}
```

# 6. Use a template to customize query rendering
By default, queries are rendered as tables, however you can render them in other ways as well. SilverBullet comes with a set of pre-defined [[^Library/Std/Infrastructure/Query Templates]] you can use, for instance:

```lua
# High qriority projects
${template.each(query[[
  from p = tags.project
  where p.priority == "high"
  order by p.lastModified desc
]], templates.pageItem)}
```

This renders your 5 most recently updated high-priority projects as a bulleted list (an `item` in SilverBullet parlance).

Of course, you can also create custom templates. Either as reusable Lua functions, or inline:

```lua
# High qriority projects
${template.each(query[[
  from p = tags.project
  where p.priority == "high"
  order by p.lastModified desc
]], template.new[==[
    * ${name} (status: ${status})
]==])}
```

# What's next?
Now that you know the basics, explore these guides for real-world workflows:

* [[Guide/Journaling]] — set up a daily journal
* [[Guide/Knowledge Base]] — build a personal knowledge base
* [[Guide/Task Management]] — track projects and tasks
* [[Guide/People Notes]] — keep track of people and conversations
* [[Manual]] — the full user manual
* [[Space Lua]] — learn more about the scripting language that gives SilverBullet a lot of its power
* [[Object]] — understand how SilverBullet indexes your content
