#guide

This guide walks you through building a personal CRM with SilverBullet. You'll use person pages, meeting notes, linked mentions, linked tasks, and page decorations to automatically track your interactions with people.

# 1. Create person pages
Make a page for someone you interact with, let’s say “Alice.” Add [[Frontmatter]] to describe them:

```yaml
---
---
```

Create a few more person pages the same way.

## Make person pages stand out
Add a `tag.define` call to your [[CONFIG]] page so person pages get a visual prefix:

```space-lua
tag.define {
  name = "person",
  transform = function(o)
    o.pageDecoration = { prefix = "🧑 " }
    return o
  end
}
```

After a reload, person pages will show a 🧑 prefix in the [[Page Picker]], [[Completion|completions]], and editor. See [[Page Decorations]] and [[API/tag]] for more options.

> **warning** Warning
> Tag customization is still a beta feature, it may change in the future.

# 2. Take meeting notes
Create a page like “Meeting/2026-03-04” and write naturally, linking to attendees:

```markdown
Met with [[Alice]] and [[Bob]] to discuss the Q2 roadmap. Alice will lead the backend migration.
```

The `[[Alice]]` and `[[Bob]]` links connect this meeting note to their person pages.

# 3. Add tasks that mention people
Write tasks that reference person pages:

```markdown
* [ ] Send proposal to [[Alice]]
* [ ] Schedule follow-up with [[Bob]]
* [ ] Share roadmap doc with [[Alice]] and [[Bob]]
```

These tasks are now linked to both the meeting notes page and the person pages.

# 4. See a person's full history
Open Alice’s page. Two things happen automatically:

* **[[Linked Tasks]]** at the top shows all incomplete tasks from other pages that mention Alice (like “Send proposal to Alice” from your meeting notes).
* **[[Linked Mention|Linked Mentions]]** at the bottom shows every page that references Alice — meeting notes, project pages, anything.

Alice’s page becomes an automatic activity log without you maintaining it.

# 5. Query across your network
Build useful views on a “People” page or your home page:

```lua
# People at Acme Corp
${query[[from p = tags.person where p.company == "Acme Corp"]]}
```

Show all people, grouped by company:

```lua
${query[[
  from p = tags.person
  order by p.company
]]}
```

# What’s next?
You now have a very basic personal CRM: person pages with structured data, meeting notes that link to attendees, tasks that reference people, and automatic activity logs via linked mentions and linked tasks.

* [[Guide/Journaling]] — set up a daily journal
* [[Guide/Knowledge Base]] — build a personal knowledge base
* [[Guide/Task Management]] — track projects and tasks
* [[Manual]] — the full user manual
