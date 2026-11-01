---
description: A checkbox item tracked as a queryable object.
tags: glossary
references:
- plugs/index/task.ts
- client/codemirror/syntax/task.ts
---

The task notation syntax is a [[Markdown]] extension to write down tasks.

Its most basic form is:

    * [ ] This is my first task

which renders as follows:

* [ ] This is my first task

In a writable space, click a checkbox to change whether the task is complete. Checkboxes in these read-only docs cannot be changed.

# Custom states
Tasks support the default `x` and ` ` states (done and not done), but custom states as well. Support for this is still basic, however.

Example:

* [NOT STARTED] Choose a photo-walk route
* [IN PROGRESS] Charge camera battery

Restrictions:

* Task states cannot contain `:` to avoid ambiguity with [[Attribute]] syntax.

To define custom states explicitly (and get code completion for them), use the [[API/taskState]] API.

# Find tasks across pages
Tasks are [[Tag/task|indexed]] so you can collect them in a query. Start with [[Guide/Build Your First Query]] to build a list in Workbench; [[Space Lua/Integrated Query]] documents the query language.
