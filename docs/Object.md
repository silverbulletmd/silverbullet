---
description: A structured, queryable unit of data extracted from your pages (e.g. tasks, items, paragraphs).
tags: glossary
references:
- client/data/object_index.ts
- plugs/index/indexer.ts
- plug-api/types/index.ts
---
Objects in SilverBullet is are _things_. Examples include [[Tag/page|pages]], [[Tag/task|tasks]], and [[Tag/relation|relations]]. SilverBullet automatically maintains an [[Object Index]] extracted from all [[Markdown]] [[Page|pages]] in your [[Space|Space]].

Objects are a feature that powers a lot of SilverBullet functionality, including the [[Page Picker]], [[Linked Mention|Linked Mentions]] and many others. They can also be queried by the user directly, typically via [[Space Lua/Integrated Query]].

There are various ways to visualize what objects exist in your space:
* [[Object Graph]]: a graph-style visualization of indexed objects and their relationships.
* [[X-Ray]]: an in-editor overlay visualizing indexed objects

# Terminology
* [[Object]]: represent _things_ in your space at various levels of granularity. Examples include [[Tag/page|pages]] at the highest level, but also more granular things like [[Tag/task|tasks]] and [[Tag/relation|relations]]. In relational database parlance, you can think of Objects as **database rows**.
* [[Tag]]: represent Object **types** or **tables** (in relational database parlance). Every Object has exactly one **root tag** saying what it is, and can have **user tags** attached, usually through the [[Markdown/Hashtags]] syntax. See [[Tag]] for every built-in tag.

# Principles
**Markdown always is the source of truth**: all data indexed as objects will have some representation in markdown text as well.

As a result, the [[Object Index]] can be flushed at any time and be rebuilt from its source markdown files kept in your space (and you can do so on demand using the `Space: Reindex` command).

# Object representation
Every object has a set of [[Attribute|Attributes]], some predefined, but you can add additional custom attributes.

The following attributes are predefined, you can expect all objects to have them:
* `ref`: a globally unique _identifier_, often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`). When an [[Markdown/Anchor]] (`$my-anchor`) is present in the object's source, the anchor name **replaces** the default `ref` (so that same task with `$rent` becomes `ref: "rent"`).
* `tag`: the object's [[Tag#Root tags|root tag]]: what kind of object it is.

In addition, most objects will also contain:
* `tags`: an optional set of [[Tag#User tags|user tags]], explicitly assigned.
* `itags`: a set of _implicit_ or _inherited_ tags: the object’s `tag` and `tags`, as well as any tags _assigned to its containing page_.
* `inComment`: `true` on any object that originates inside an HTML [[Markdown/Comment]]. Absent otherwise.

Beside these, any number of additional tag-specific and custom [[Attribute|Attributes]] can be defined. It is also possible to restrict this set of attributes via [[Schema]].

SilverBullet also supports [[X-Ray]], which will visually annotate the identified and indexed objects in the editor directly.
