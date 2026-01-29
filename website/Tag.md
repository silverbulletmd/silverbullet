Tags in SilverBullet are used to encode types of [[Object|Objects]], they’re similar to tables in relational databases, or classes in object-oriented programming.

Every [[Object]] has a main `tag`, which signifies the type of object being described. In addition, any number of additional tags can be assigned as well via the `tags` attribute. You can use either the main `tag` or any of the `tags` as query sources in [[Space Lua/Lua Integrated Query]].

# Built-in tags
${widgets.subPages("Object")}

# Custom tags
Tags are impliclty created when you use the [[Markdown/Hashtags]] syntax. Their behavior and functionality can be further expanded via the [[API/tag]] API.

