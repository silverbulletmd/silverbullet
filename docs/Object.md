---
description: "A queryable record extracted from your space, such as a page, task or relation."
tags: glossary
references:
- client/data/object_index.ts
- plugs/index/indexer.ts
- plug-api/types/index.ts
---
Objects are structured records extracted from your space. Examples include [[Tag/page|pages]], [[Tag/task|tasks]], and [[Tag/relation|relations]]. SilverBullet automatically maintains an [[Object Index]] extracted from all [[Markdown]] [[Page|pages]] in your [[Space|Space]].

The [[Page Picker]] and [[Linked Mention|Linked Mentions]] read these objects. You can inspect them in [[Workbench]] or query them with [[Space Lua/Integrated Query]].

To see objects in context, use:
* [[Graph View]]: a graph-style visualization of indexed objects and their relationships.
* [[X-Ray]]: an in-editor overlay visualizing indexed objects

# Terminology
* An [[Object]] is one record, such as a page, task or relation. In a relational database, it would be a row.
* A [[Tag]] groups objects for queries, much like a database table. Every object has exactly one root tag saying what it is, and can have user tags attached, usually through [[Markdown/Hashtags]]. See [[Tag]] for every built-in tag.

# Principles
**Space files are the source of truth**: page content produces objects such as tasks and links. Non-Markdown documents produce [[Tag/document|document objects]] from file metadata.

The [[Object Index]] can be rebuilt from those files with the `Space: Reindex` command.

# Object representation
Objects have predefined and custom [[Attribute|attributes]]. Every object has these fields:
* `ref`: a globally unique _identifier_, often represented as a pointer to the place (page, position) in your space where the object is defined. For instance, a _page_ object will use the page name as its `ref` attribute, and a `task` will use `page@pos` (where `pos` is the location the task appears in `page`). When an [[Markdown/Anchor]] (`$my-anchor`) is present in the object’s source, the anchor name **replaces** the default `ref` (so that same task with `$rent` becomes `ref: "rent"`).
* `tag`: the object’s [[Tag#Root tags|root tag]]: what kind of object it is.

In addition, most objects will also contain:
* `tags`: an optional set of [[Tag#User tags|user tags]], explicitly assigned.
* `itags`: a set of _implicit_ or _inherited_ tags: the object’s `tag` and `tags`, as well as any tags _assigned to its containing page_.
* `inComment`: `true` on any object that originates inside an HTML [[Markdown/Comment]]. Absent otherwise.

Each tag can define additional fields. You can add custom attributes and restrict their values with [[Schema]].
