The task notation syntax is a [[Markdown]] extension to write down tasks.

Its most basic form is:

    * [ ] This is my first task

which renders as follows:

* [ ] This is my first task

# Custom states
Tasks support the default `x` and ` ` states (done and not done), but custom states as well. Custom states used across your space are kept in [[Object#taskstate]].

Example:

* [NOT STARTED] Task 1
  Fix having global variables work in markdown.expandMarkdown
* [IN PROGRESS] Task 2

Restrictions:

* Task states cannot contain `:` to avoid ambiguity with [[Attribute]] syntax.

# Querying
SilverBullet allows you to simply toggle the complete state of a task by clicking the checkbox. It also allows for querying tasks as [[Object#task]]. For instance:

${query[[from index.tag "task" where page == editor.getCurrentPage()]]}
