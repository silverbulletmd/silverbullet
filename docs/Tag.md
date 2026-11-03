---
description: "SilverBullet's mechanism to classify objects and groups them."
tags: glossary
references:
- plugs/index/tags.ts
- plug-api/lib/tags.ts
- libraries/Library/Std/APIs/Tag.md
---
Tags are a means to group [[Object|Objects]] in meaningful ways. In concept they are similar to “classes”, “types” or “tables.” 

There are a few types of tags:
* [[#Root tags]]: every object has a _root tag_ — mapping to what kind of markdown object was tagged, e.g. `page`, `task`, `paragraph`, or `item`.
* [[#User tags]]: optionally, an object can receive one or more _user tags_ that are explicitly attached, either via the `tags` frontmatter attribute, or by using a [[Markdown/Hashtags]] in markdown.
* [[#Edge tags]]: specically: [[Tag/relation]] whose objects are automatically derived from links that appear in a page.

Confused? Start with [[Guide/Add Structure and Query]] for some examples.

# Root tags
A root tag maps an object to a Markdown element or a file. Every root tag also accepts user tags.

* [[Tag/data|data]]: Objects defined in fenced YAML data blocks.
* [[Tag/document|document]]: Every non-Markdown file in your space: images, PDFs, attachments.
* [[Tag/header|header]]: Markdown headings.
* [[Tag/item|item]]: Bullet and numbered list items.
* [[Tag/page|page]]: Every page in your space.
* [[Tag/paragraph|paragraph]]: Top-level paragraphs that carry a hashtag or anchor.
* [[Tag/table|table]]: Rows of Markdown tables.
* [[Tag/task|task]]: Checkbox list items, including their completion state.

You can also define root tags of your own, using a fenced [[Tag/data|data block]] with a hashtag as its language:

~~~
```#contact
name: Sam Rivera
```
~~~

# User tags
User tags are created implicitly when you use the [[Markdown/Hashtags]] syntax, or list them in the `tags` attribute of [[Frontmatter]] or a data block. They are attached to an object _in addition_ to its root tag: a task tagged `#upnext` has root tag `task` and user tag `upnext`, and is returned both by `index.tasks()` and `index.objects("upnext")`.

You can extend the behavior of any tag, root or user, via the [[API/tag]] API, for instance to give it a [[Schema]].

# Edge tags
Objects are the nodes of the [[Graph View]]. Edges connect them.

* [[Tag/relation|relation]]: Connections between objects: links, mentions and typed attributes.

# System tags
These are used, mostly for internal use to store markdown blocks that configure SilverBullet rather than hold content. You can’t attach tags to them, and commenting one out turns it off.

* [[Tag/space-lua|space-lua]]: Space Lua code blocks, run when the client boots.
* [[Tag/space-style|space-style]]: Space Style CSS blocks, applied to the client.

# Index tags
Records the [[Object Index]] keeps about the space itself. They are computed, with no Markdown of their own.

* [[Tag/ambiguous-link|ambiguous-link]]: Links whose name matches more than one page.
* [[Tag/anchor|anchor]]: Named anchors, each pointing at the object it is attached to.
* [[Tag/aspiring-page|aspiring-page]]: Pages that are linked to but do not exist yet.
* [[Tag/identity|identity]]: The `@name` mentions across the space.
* [[Tag/tag|tag]]: Every tag used in the space, with the root tag it is used on.
