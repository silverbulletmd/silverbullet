---
description: A label applied to objects that says what they are, or groups them for querying.
tags: glossary
references:
- plugs/index/tags.ts
- plug-api/lib/tags.ts
- libraries/Library/Std/APIs/Tag.md
---
Tags are a means to classify _things_ (or more specifically: [[Object|Objects]]). “This is a _person_.” “This is a _meeting_.” Tags in SilverBullet can be applied at various levels, and have multiple use cases.

One way to think of tags are _types_ of [[Object|objects]]. They are similar to _tables_ in a relational database, or _classes_ in object-oriented programming. You can use any tag as a query source in [[Space Lua/Integrated Query]].

Every [[Object]] has exactly one **root tag**, stored in its `tag` attribute, which says what the object _is_. On top of that, it can carry any number of **user tags**, stored in its `tags` attribute. Its `itags` attribute combines both, plus the tags it inherits, such as those of its page.

# Root tags
A root tag maps an object to a Markdown element or a file. Every root tag also accepts user tags.

${query[[
  from p = index.subPages("Tag")
  where p.tagKind == "root"
  order by p.name
  select template.new[==[
    - [[${name}|${string.sub(name, 5)}]]: ${description}
]==](p)
]]}

You can also define root tags of your own, using a fenced [[Tag/data|data block]] with a hashtag as its language:

```#contact
name: Pete
```

# Edge tags
Objects are the nodes of the [[Object Graph]]. Edges connect them.

${query[[
  from p = index.subPages("Tag")
  where p.tagKind == "edge"
  order by p.name
  select template.new[==[
    - [[${name}|${string.sub(name, 5)}]]: ${description}
]==](p)
]]}

# User tags
User tags are created implicitly when you use the [[Markdown/Hashtags]] syntax, or list them in the `tags` attribute of [[Frontmatter]] or a data block. They are attached to an object _in addition_ to its root tag: a task tagged `#upnext` has root tag `task` and user tag `upnext`, and is returned both by `index.tasks()` and `index.objects("upnext")`.

You can extend the behavior of any tag, root or user, via the [[API/tag]] API, for instance to give it a [[Schema]].

# System tags
These are used, mostly for internal use to store markdown blocks that configure SilverBullet rather than hold content. You can’t  attach tags to them, and commenting one out turns it off.

${query[[
  from p = index.subPages("Tag")
  where p.tagKind == "system"
  order by p.name
  select template.new[==[
    - [[${name}|${string.sub(name, 5)}]]: ${description}
]==](p)
]]}

# Index tags
Records the [[Object Index]] keeps about the space itself. They are computed, with no Markdown of their own.

${query[[
  from p = index.subPages("Tag")
  where p.tagKind == "index"
  order by p.name
  select template.new[==[
    - [[${name}|${string.sub(name, 5)}]]: ${description}
]==](p)
]]}
