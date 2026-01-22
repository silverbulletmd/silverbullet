Every task in your space is tagged with the `task` tag by default. You tag it with additional tags by using [[Tag]] in the task name, e.g.

* [ ] My task #upnext 

And can then be queried via either `task` or `upnext`. 

The following query shows all attributes available for tasks:
${query[[from index.tag "upnext"]]}

Although you may want to render it using a template instead:
${template.each(query[[from index.tag "upnext"]], templates.taskItem)}

Specific attributes:
* `done`: set to true of the state of the task is “checked”
* `state`: the text of the state (useful for custom states), see [[^Library/Std/APIs/Task State]]

Additionally, tasks inherit all attributes of [[Object/item]].