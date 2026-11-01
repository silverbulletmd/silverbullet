---
tags: guide
---
Build these small queries in Workbench, then copy their source when you want to adapt them.

These recipes assume the `Photo Walk` and `Reading List` pages from [[Getting Started]], including their tags and task attributes. Use a writable practice space. Code blocks here are inert examples: paste a whole `${query[[…]]}` expression into a destination page’s body, outside the code fence, to render it.

SilverBullet stores this query as text in your page. It uses SLIQ, a query language built into Space Lua. You can build and edit it in Workbench without learning the syntax. Start with [[Guide/Build Your First Query]] for the insertion and reopening workflow.

# Unfinished tasks on one page
Run `Workbench: Query`. Choose **From** `task`, add **Where** filters `done` **is false** and `page` **is** `Photo Walk`, order by `name` **A–Z**, choose **Select → List → templates.taskItem**, and set **Limit** to `10`.

```markdown
${query[[
  from t = index.tasks()
  where not t.done and t.page == "Photo Walk"
  order by t.name
  limit 10
  select templates.taskItem(t)
]]}
```

Expected: the battery and binoculars tasks, if both are still incomplete. Checkboxes in the rendered task list change the original tasks. To include every page, remove the `page` condition or its builder filter.

# Packing tasks with a due date
Choose `task`, narrow it to the user tag `packing`, and add filters for `done` **is false** and `due` **exists**. Order by `due` **earliest first**. Choose the task-list template again.

```markdown
${query[[
  from t = index.tasks("packing")
  where not t.done and t.due ~= nil
  order by t.due
  select templates.taskItem(t)
]]}
```

Expected: `Charge camera battery`, with due date `2026-06-13`. The binoculars task has no due date and is excluded. This recipe lists dated tasks; it does not compare their dates with today. Keep dates consistently formatted as quoted `YYYY-MM-DD` values when sorting them as text.

# Planned outing pages
Choose **From** `page`, keep the **Content** scope, narrow to `outing`, filter `status` **is** `planned`, order by `name` **A–Z**, and select **List → templates.pageItem**.

```markdown
${query[[
  from p = index.contentPages("outing")
  where p.status == "planned"
  order by p.name
  select templates.pageItem(p)
]]}
```

Expected: a link to `Photo Walk`. This is a page query. Tagging only a task `#outing` would not turn its containing page into an outing page. Use `index.tasks("outing")` when you intend to query tasks instead.

# Count tasks by completion state
Choose **From** `task`, filter `page` **is** `Photo Walk`, then add `done` under **Group By**. In **Select**, include the group key `done` and a `count` aggregate. The two groups summarize tasks rather than displaying each task.

```markdown
${query[[
  from t = index.tasks()
  where t.page == "Photo Walk"
  group by t.done
  select {done = done, count = #group}
]]}
```

Expected: one false group with count `2` and one true group with count `1`, before completing any packing tasks. Completing a task moves it between those groups. Empty groups are not returned. [[Space Lua/Integrated Query/Grouping]] explains group keys, `#group`, `having` and ordering; [[Space Lua/Integrated Query/Aggregating]] describes the aggregate functions.

# Adapt safely
Use the result widget’s **Edit in query builder** menu to reopen a supported query. **Update page** replaces the original expression. Keep your own copy before trying handwritten syntax that the builder may not understand. Use **Run in Console** when you want to inspect values without inserting a result.

If a result looks wrong, check the source kind, tag scope and missing values before adding more conditions. [[Guide/When Results Update]] explains timing; [[Workbench/Query]] and [[Space Lua/Integrated Query]] retain the complete control and language references.
