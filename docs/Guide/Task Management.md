---
tags: guide
---
Keep tasks where they arise, link them to their subject, and use focused lists to see what remains.

# 1. Create a project page
Use `Photo Walk` from [[Guide/Your First Markdown Page]], or create it in your practice space. Describe the plan in prose and add tasks:

```markdown
* [ ] Charge camera battery
* [ ] Pack binoculars
* [x] Check the weather
```

Type the checkbox syntax directly or use `/task` on a line. Click a checkbox to complete it. [[Task]] explains task states and editing commands.

If you need a project-level category, add frontmatter at the very beginning:

```markdown
---
tags: outing
status: planned
date: "2026-06-14"
---
```

The page’s status is separate from task completion. SilverBullet does not automatically mark the outing complete when its tasks are done.

# 2. Annotate tasks with attributes
Add a due date or a category to the individual task that needs it:

```markdown
* [ ] Charge camera battery #packing [due: "2026-06-13"]
* [ ] Pack binoculars #packing
```

The `packing` tag and `due` attribute attach to those tasks. Every task already has the built-in `task` tag. Page tags and attributes describe the page; they are not a substitute for task-level fields. See [[Attribute]], [[Markdown/Hashtags#Scope rules]] and [[Tag/task]] for the exact fields.

# 3. Scatter tasks across pages
Sam’s friend Jo helps organize the photo-club activities. On a practice page named `Meetup Notes`, write:

```markdown
Jo will confirm the route for the photo club.

* [ ] Send Jo the meeting point for [[Photo Walk]]
```

The page link connects the task to the outing without moving it out of the meeting notes.

# 4. See linked tasks automatically
Open `Photo Walk`. The **Linked Tasks** view, normally above the page, collects incomplete tasks from other pages that link to it, including the meeting-point task. It does not duplicate tasks already on the current page. Run `Navigate: Linked Tasks` if you need to show the view.

Check a linked task to complete its original on `Meetup Notes`. [[Linked Tasks]] explains inherited links and the view’s exact behavior. [[Linked Mention|Linked Mentions]] provides the broader list of page references.

# 5. Build a dashboard
Create `Walk Dashboard`, put the cursor below a heading and run `Workbench: Query`. Choose `task`, filter `done` **is false**, order by `name` **A–Z**, select **List → templates.taskItem**, and limit to `10`. Use **Insert at cursor**. [[Guide/Build Your First Query]] walks through every step, including editing the result later.

The corresponding source, for readers ready to adapt it, is:

```markdown
${query[[
  from t = index.tasks()
  where not t.done
  order by t.name
  limit 10
  select templates.taskItem(t)
]]}
```

To show only dated tasks, add a `due` **exists** filter and sort by `due` **earliest first**:

```markdown
${query[[
  from t = index.tasks()
  where not t.done and t.due ~= nil
  order by t.due
  limit 10
  select templates.taskItem(t)
]]}
```

This lists dated work; it does not mean that every listed task is currently due. If your space already uses `deadline` rather than `due`, select that field consistently in both the task annotations and query.

For an outing overview, choose `page`, **Content** scope and the `outing` tag, filter `status` **is** `planned`, and choose the page-list template:

```markdown
${query[[
  from p = index.contentPages("outing")
  where p.status == "planned"
  select templates.pageItem(p)
]]}
```

Live lists update after notes are saved and indexed. [[Guide/When Results Update]] describes timing and why baked snapshots differ.

# What’s next?
* [[Journal]] — optionally capture daily work.
* [[Guide/Query Recipes]] — filter and group tasks in other ways.
* [[Guide/Knowledge Base]] — link tasks to useful background notes.
