The task notation syntax is a [[Markdown]] extension to write down tasks.

Its most basic form is:

    * [ ] This is my first task

which renders as follows:

* [ ] This is my first task

SilverBullet allows you to simply toggle the complete state of a task by clicking the checkbox.

All tasks across your space are automatically [[Object/task|indexed]] and can therefore be [[Space Lua/Lua Integrated Query|queried]].

# Custom states
Tasks support the default `x` and ` ` states (done and not done), but custom states as well. Support for this is still basic, however.

Example:

* [NOT STARTED] Task 1
  Fix having global variables work in markdown.expandMarkdown
* [IN PROGRESS] Task 2

Restrictions:

* Task states cannot contain `:` to avoid ambiguity with [[Attribute]] syntax.

To define custom states explicitly (and get code completion for them), use the [[API/taskState]] API.
