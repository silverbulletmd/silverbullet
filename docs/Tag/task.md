---
description: List items with a checkbox; builds on item.
tagKind: root
references:
- plugs/index/task.ts
- client/codemirror/syntax/task.ts
---
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tag]] in the task name, e.g.

* [ ] My task #upnext

Query all tasks with `index.tasks()`, or only those tagged `upnext` with `index.tasks("upnext")`. This query shows matching records and their fields:
${query[[from index.tasks("upnext")]]}

To display the same results as checkboxes:
${query[[from index.tasks("upnext") select templates.taskItem(_)]]}

Specific attributes:
* `done`: `true` for `x`, `X`, or a custom state registered with `done = true`; otherwise `false`.
* `state`: checkbox text between `[` and `]`, including a single space for an unchecked task; see [[API/taskState]] for custom states.

Additionally, tasks inherit all attributes of [[Tag/item]].