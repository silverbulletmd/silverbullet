SilverBullet automatically maintains an [[Object Index]] extracted from all [[Markdown]] [[Page|pages]] in your [[Space|Space]].

Objects are a feature that powers a lot of SilverBullet functionality, including the [[Page Picker]], [[Linked Mention|Linked Mentions]] and many others. They can also be queried by the user directly, typically via [[Space Lua/Lua Integrated Query]].

# Terminology
* [[Object]]: represent _things_ in your space at various level of granularity. Examples include [[Object/page]] at the highest level, but also more granular things like [[Object/task]] and [[Object/link]]. In relational database parlance, you can think of Objects as **database rows**.
* [[Tag]]: represent Object **types** or **tables** (in relational database parlance). Every Object has at least one tag, but can have additional tags attached explicitly, usually through the [[Markdown/Hashtags]] syntax. 

# Principles
**Markdown always is the source of truth**: all data indexed as objects will have some representation in markdown text as well. 

As a result, the [[Object Index]] can be flushed at any time and be rebuilt from its source markdown files kept in your space (and you can do so on demand using the `Space: Reindex` command).

# Object representation
Every object has a set of [[Attribute|Attributes]], some predefined, but you can add additional custom attributes.

The following attributes are predefined, you can expect all objects to have them:
* `ref`: a globally unique _identifier_, often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`).
* `tag`: the main type, or “tag” of the object.

In addition, most objects will also contain:
* `tags`: an optional set of additional, explicitly assigned tags.
* `itags`: a set of _implicit_ or _inherited_ tags: including the object’s `tag`, `tags` as well as any tags _assigned to its containing page_.

Beside these, any number of additional tag-specific and custom [[Attribute|Attributes]] can be defined. It is also possible to restrict this set of attributes via [[Schema]].
