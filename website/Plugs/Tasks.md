---
tags: plug
---
The Tasks plug implements task support in SilverBullet.

## Task states
The tasks plug support the standard “done” and “not done” states via `[x]` and `[ ]` notation in the context of a list (this is fairly widely accepted [[Markdown]] syntax):

* [ ] This is a task (toggle me!)

However, custom states can also be used for extra flexibility:

* [TODO] This task is still to do
* [IN PROGRESS] In progress task
* [RESOLVED] A resolved task
* [-] Whatever this state means
* [/] Or this one

You can cycle through the states by clicking on the status or by running the {[Task: Cycle State]} command while on a task. There is also auto complete for all known custom task states in a space.

To delete completed task from a page you can use {[Task: Remove Completed]}.

## Annotations
Tasks can also be annotated with [[Tags]]:

* [ ] This is a tagged task #my-tag

As well as [[Attributes]]:

* [ ] This is a task with attributes [taskAttribute: true]

## Deadlines

Tasks can specify deadlines:

* [ ] This is due 📅 2022-11-26

When the cursor is positioned inside of a due date, the {[Task: Postpone]} command can be used to postpone the task for a certain period.

## Querying
All meta data (`done` status, `state`, `tags`, `deadline` and custom attributes) is extracted and available via the `task` query source to [[Live Queries]]:

```query
task where page = @page.name
```

## Rendering
There is a [[!silverbullet.md/template/tasks/task]] template you can use to render tasks nicely rather than using the default table (as demonstrated above). When you use this template, you can even cycle through the states of the task by click on its state _inside_ the rendered query, and it will update the state of the _original_ task automatically, this works across pages.
