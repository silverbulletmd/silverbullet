---
description: A label applied to objects that says what they are, or groups them for querying.
tags: glossary
references:
- plugs/index/tags.ts
- plug-api/lib/tags.ts
- libraries/Library/Std/APIs/Tag.md
---
Tags group pages, tasks and other content so you can find and query them. Start with [[Guide/Organize with Tags and Attributes]] for examples, then inspect them in [[Workbench/Query]].

# What the fields mean
Each indexed [[Object|object]] has a root `tag` identifying its kind, such as `page` or `task`. The `tags` field holds its explicit user tags. The `itags` field includes those tags, its root tag and inherited tags, such as tags on the containing page. Querying a tag includes these inherited matches.

For example, on a page tagged `outing`, the task `* [ ] Pack binoculars #packing` has root tag `task`, explicit tag `packing`, and inherits `outing`. You can find it among tasks or among objects tagged `packing` or `outing`.

A hashtag in prose classifies that paragraph; a standalone line of hashtags tags the page. A fenced `#contact` data block creates records whose root tag is `contact` and which also inherit `data`. The same word used as a hashtag and as a data-block language therefore has different scope. See [[Markdown/Hashtags]] and [[Tag/data]].

The categories below describe the kinds of records in the index. They are separate from the distinction between explicit and inherited tags.

# Root tags
A root tag maps an object to a Markdown element or a file. Every root tag also accepts user tags.

* [[Tag/data|data]]: Objects from fenced YAML data blocks, which is also how you define root tags of your own.
* [[Tag/document|document]]: Every non-Markdown file in your space: images, PDFs, attachments.
* [[Tag/header|header]]: Markdown headings.
* [[Tag/item|item]]: Bullet and numbered list items.
* [[Tag/page|page]]: Every page in your space.
* [[Tag/paragraph|paragraph]]: Top-level paragraphs that carry a hashtag or anchor.
* [[Tag/table|table]]: Rows of Markdown tables.
* [[Tag/task|task]]: List items with a checkbox; builds on item.

You can also define root tags of your own, using a fenced [[Tag/data|data block]] with a hashtag as its language:

```#contact
name: Sam Rivera
```

# Edge tags
Objects are the nodes of the [[Graph View]]. Edges connect them.

* [[Tag/relation|relation]]: Connections between objects: links, mentions and typed attributes.

# User tags
User tags are created implicitly when you use the [[Markdown/Hashtags]] syntax, or list them in the `tags` attribute of [[Frontmatter]] or a data block. They are attached to an object _in addition_ to its root tag: a task tagged `#upnext` has root tag `task` and user tag `upnext`, and is returned both by `index.tasks()` and `index.objects("upnext")`.

You can extend the behavior of any tag, root or user, via the [[API/tag]] API, for instance to give it a [[Schema]].

# System tags
These are used, mostly for internal use to store markdown blocks that configure SilverBullet rather than hold content. You can’t attach tags to them, and commenting one out turns it off.

* [[Tag/space-lua|space-lua]]: Space Lua code blocks, run when the client boots.
* [[Tag/space-style|space-style]]: Space Style CSS blocks, applied to the client.

# Index tags
Records the [[Object Index]] keeps about the space itself. They are computed, with no Markdown of their own.

* [[Tag/ambiguous-link|ambiguous-link]]: Links whose name matches more than one page.
* [[Tag/anchor|anchor]]: Named anchors, each pointing at the object it is attached to.
* [[Tag/aspiring-page|aspiring-page]]: Pages that are linked to but don’t exist yet.
* [[Tag/identity|identity]]: The `@name` mentions across the space.
* [[Tag/tag|tag]]: Every tag used in the space, with the root tag it is used on.
