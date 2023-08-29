---
type: plug
repo: https://github.com/silverbulletmd/silverbullet
---

The Tasks plug implements a lot of the task support in SilverBullet.

Tasks in SilverBullet are written using semi-standard task syntax:

* [ ] This is a task

Tasks can also be annotated with [[Tags]]:

* [ ] This is a tagged task #my-tag

You can _toggle_ a task state either by putting in an `x` or `X` inside the box or by simply clicking/tapping on the box. Alternatively, you can use the {[Task: Toggle]} command to toggle the task you’re currently in.

Tasks can specify deadlines:

* [ ] This is due 📅 2022-11-26

When the cursor is positioned inside of a due date, the {[Task: Postpone]} command can be used to postpone the task for a certain period.

This metadata is extracted and available via the `task` query source to [[🔌 Directive/Query]]:

<!-- #query task where page = "{{@page.name}}" -->
|name                         |done |page    |pos|tags  |deadline  |
|-----------------------------|-----|--------|---|------|----------|
|This is a task               |false|🔌 Tasks|213|      |          |
|This is a tagged task #my-tag|false|🔌 Tasks|279|my-tag|          |
|This is due                  |false|🔌 Tasks|565|      |2022-11-26|
<!-- /query -->
