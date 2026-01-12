SilverBullet automatically builds and maintains an index of _objects_ extracted from all [[Markdown]] [[Page]] in your [[Space|Space]]. It subsequently allows you to use [[Space Lua/Lua Integrated Query]] to query this database in (potentially) useful ways.

By design, the truth remains in the markdown: all data indexed as objects will have a representation in markdown text as well. This index can be flushed at any time and be rebuilt from its source markdown files kept in your space (and you can do so on demand if you like using the `Space: Reindex` command).

# Object representation
Every object has a set of [[Attribute|Attributes]], some predefined, but you can add any additional custom attributes that you like.

The following attributes are predefined, and you can expect all objects to have them:
* `ref`: a globally unique _identifier_, often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`).
* `tag`: the main type, or “tag” of the object, usually a built-in type (see below for a list).

In addition, many objects will also contain:
* `tags`: an optional set of additional, explicitly assigned tags.
* `itags`: a set of _implicit_ or _inherited_ tags: including the object’s `tag`, `tags` as well as any tags _assigned to its containing page_. This is useful to answer queries like, “give me all tasks on pages where that page is tagged with `person`“, which would be expressed as `query[[from index.tag "task" where table.includes(_.itags, "person")]]` (although technically that would also match any tags that have the `#person` explicitly assigned).

Beside these, any number of additional tag-specific and custom [[Attribute]] can be defined (see below).

# Tags
Every object has a main `tag`, which signifies the type of object being described. If you’re familiar with SQL databases, you can think of these as _tables_, or in object-oriented parlance you can think of them as _classes_. In addition, any number of additional tags can be assigned as well via the `tags` attribute. You can use either the main `tag` or any of the `tags` as query sources in [[Space Lua/Lua Integrated Query]] — examples below.
${index.}
# Built-in tags
${widgets.subPages()}