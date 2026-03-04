#guide

This guide walks you through a project and task management workflow. You'll learn how tasks, frontmatter, linked tasks, and queries combine into a lightweight project tracker — no extra tools needed.

# 1. Create a project page
Make a page called "Website Redesign" with structured [[Frontmatter]]:

```yaml
---
tags: project
status: active
priority: high
---
```

Below the frontmatter, write a brief description of the project and its goals.

# 2. Add tasks
Type `/task` to insert a task (or just type `* [ ] ` directly). Add a few tasks on the project page:

```markdown
* [ ] Write the project proposal
* [ ] Create wireframes
* [ ] Set up staging environment
```

Click a checkbox to mark a task as done. All tasks are automatically indexed and queryable.

# 3. Annotate tasks with attributes
Add metadata to tasks using [[Attribute]] syntax:

```markdown
* [ ] Write the proposal [deadline: "2026-03-15"] [priority: high]
* [ ] Review design mockups [assignee: Alice]
```

Optionally hashtags on tasks to categorize them:

```markdown
* [ ] Get client approval #waiting
```

This task is now tagged both `task` and `waiting`, so you can query either tag.

# 4. Scatter tasks across pages
Real tasks don’t all live in one place — they come up in meetings, while reading, or during other work. Create a page like "Meeting Notes/2026-03-04" and write tasks that link back to the project:

```markdown
* [ ] Send updated mockups to client [[Website Redesign]]
* [ ] Schedule review meeting [[Website Redesign]]
```

The `[[Website Redesign]]` link connects these tasks to the project.

# 5. See linked tasks automatically
Navigate to your "Website Redesign" page. At the top, the **[[Linked Tasks]]** widget shows all incomplete tasks from _other_ pages that link to this page — including the ones from your meeting notes.

You can check off a linked task from either page; the state change propagates. No manual copying or moving of tasks needed.

# 6. Build a dashboard
Create a "Dashboard" page that pulls everything together using [[Space Lua/Lua Integrated Query]]:

```lua
# Active projects
${query[[from p = tags.project where p.status == "active"]]}
```

Add a section for (recently) open tasks (maximum 10):

```lua
# Open tasks
${template.each(query[[
  from t = tags.task
  where not t.done
  order by t.lastModified desc
  limit 10
]], templates.taskItem)}
```

And a section for tasks with deadlines:

```lua
# Due soon
${template.each(query[[
  from t = tags.task
  where not t.done and t.deadline
  order by t.deadline
  limit 5
]], templates.taskItem)}
```

Each section updates live as you add, complete, or modify tasks across your space.

# What's next?
You now have a project tracking system: project pages with frontmatter, tasks scattered naturally across pages, linked tasks that connect everything, and a dashboard for the big picture.

* [[Guide/Journaling]] — set up a daily journal
* [[Guide/Knowledge Base]] — build a personal knowledge base
* [[Guide/People Notes]] — keep track of people and conversations
* [[Manual]] — the full user manual
