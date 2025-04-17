The task notation syntax is a [[Markdown]] extension to write down tasks:

Its most basic form is:

    * [ ] My task name

which renders as follows:
* [ ] My task name

SilverBullet allows you to simply toggle the complete state of a task by clicking the checkbox. It also allows for querying tasks as [[Objects#task]]. For instance:

${query[[from index.tag "task" where page == editor.getCurrentPage()]]}
