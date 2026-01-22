Tags in SilverBullet are used to encode types of [[Object|Objects]], they’re the SilverBullet analogy to tables in SQL databases.

Every [[Object]] has a main `tag`, which signifies the type of object being described. If you’re familiar with SQL databases, you can think of these as _tables_, or in object-oriented parlance you can think of them as _classes_. In addition, any number of additional tags can be assigned as well via the `tags` attribute. You can use either the main `tag` or any of the `tags` as query sources in [[Space Lua/Lua Integrated Query]].

# Built-in tags
${widgets.subPages("Object")}

# Custom tags
To create a tag, you can simply use it with the [[Markdown/Hashtags]] syntax. The moment you use a hash tag somewhere, you will auto complete it. If you’d like to tweak or otherwise enhance your custom tags, have a look at the [[API/tag]] API.
