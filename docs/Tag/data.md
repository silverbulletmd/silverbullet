---
description: Objects from fenced YAML data blocks, which is also how you define root tags of your own.
tagKind: root
references:
- plugs/index/data.ts
- plugs/index/yaml.ts
---
You can embed YAML data in a page with a [[Markdown/Fenced Code Block|fenced code block]]. Each block becomes one or more queryable objects.

## Defining your own root tags
Use a hashtag as the block's language, and every object in it gets that name as its [[Tag#Root tags|root tag]]. This is how you define a new kind of object in plain Markdown:

```#contact
$ref: pete-contact
name: Pete
age: 55
```

These objects can be queried via the `contact` tag:
${query[[from index.objects("contact")]]}

Built-in tag names are taken: a ` ```#task ` block would look like a real task, so it is not indexed, and lint flags it.

## Several objects per block
Separate objects with a `---` line:

```#contact
name: Linda
---
name: Jack
```

The `/data` [[Slash Command]] inserts an empty data block, with the cursor where its tag goes. Once you leave the block it shows as an empty form; **+ add item** below the last item adds another one, and **Delete** in an item's ⋯ menu removes it (with the whole block when it is the last one).

## Editing as a form
In the editor, each object of a data block shows as a form. To edit data blocks as plain YAML instead, switch off **Edit data blocks as a form** in the [[Configuration Manager]]  or put this in your [[CONFIG]]:

```lua
config.set("liveEdit", { dataBlocks = false })
```

## Attributes
Every YAML key becomes an attribute, except the ones the index manages itself: `ref`, `tag`, `itags`, `page`, `pos` and `range`.
* `$ref`: gives the object a [[Markdown/Anchor|named anchor]] to use as its `ref`, so it can be linked to and looked up.
* `tags`: [[Tag#User tags|user tags]] for the object, as a list or a string like `friend, neighbor`.
* `itags` always includes `data`, whichever root tag the object has.

## Querying
`index.data()` returns every data object, whichever block it comes from. Pass a tag to narrow it down, e.g. `index.data("contact")`:

${query[[from index.data() where page == _CTX.currentPage.name select {tag=tag, name=name}]]}
