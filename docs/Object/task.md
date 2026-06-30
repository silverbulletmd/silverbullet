---
references:
- plugs/index/task.ts
- client/codemirror/task.ts
---
Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tag]] in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`. 

The following query shows all attributes available for tasks:
${query[[from index.tasks("upnext")]]}

Although you may want to render it using a template instead:
${query[[from index.tasks("upnext") select templates.taskItem(_)]]}

Specific attributes:
* `done`: set to true of the state of the task is “checked”
* `state`: the text of the state (useful for custom states), see [[^Library/Std/APIs/Task State]]

Additionally, tasks inherit all attributes of [[Object/item]].