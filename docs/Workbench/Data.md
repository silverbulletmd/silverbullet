---
description: "Browse your space's objects by tag, build queries without writing them, and define tag schemas."
aliases:
- Workbench/Query
references:
- client/workbench/data/**
- client/workbench/query/**
---
The Data tab shows the objects in your space by [[Tag]]: your pages, tasks, and everything you tagged. The header shows how many objects the tag has and whether it has a schema; click that to open its schema. For the selected tag it has two views: **Objects**, where a query editor narrows, sorts and groups the objects without you having to know the query syntax, and **Schema**, where you look at and edit the tag's attributes.

${widgets.commandButton("Workbench: Data")} opens this tab in the [[Workbench]], and ${widgets.commandButton("Workbench: Schema")} opens it on Schema.

# The tag list
* **Pinned** tags come first: `page` and `task` unless you change them. Hover a tag and click its pin to pin or unpin it. Pins are kept in the `workbench.pinnedTags` option of your [[^Library/Config]], so everyone using the space sees the same ones.
* **Defined**: your tags that have a [[Schema]], most objects first. A tag with objects that don't match its schema shows a ⚠ count. A tag that's defined but not used yet is grayed out.
* **No schema**: your tags without one, most objects first, so the list reads as a to-do list.
* **Built-in**: the tags SilverBullet indexes itself (`item`, `link`, `header`, …), collapsed until you open it.

Tags from [[Tag/data|data blocks]] carry a small `data` label. Drag the list's right edge to make it wider; double-click the edge to reset it. Typing in the filter narrows every section; Enter picks the first match. Each tag shows its icon: a tag's `icon`, or else the icon of its `pageDecoration` (see [[API/tag]]).

# Objects
The Objects view has three parts:

* **The query editor**: one row per part of the query, named after the keyword it writes.
* **The results**: rendered the way the query renders on a page (or as Lua values). It shows the first 200 rows of a large result.
* **The query bar** at the bottom.

## Building a query
* **From:** the tag picked in the list. For `page` and `task`, *tagged* narrows them to one of your tags, and *Open #tag* jumps to that tag.
* **Where:** filters, all of which must match:
  * *+ Filter* picks an attribute, then an operator that suits its type.
  * *+ Expression* takes any Lua condition.
* **Group By:** one result per distinct value of an attribute (or combination of attributes). The **Select** row then shows group columns: each is a group key or an aggregate of an attribute, like `count` or `avg`, including your own [[Space Lua/Integrated Query/Aggregating|aggregates]].
* **Order By:** the order, with directions named for the attribute’s type (*earliest first*, *A–Z*, *high to low*). Click an order to flip it. While grouping, you order by a group key or an aggregate column.
* **Select:** what each result shows.
  * **Table** (the default): a column per attribute the objects have. Remove, rename and reorder columns, or *Clear all* to start from none. A *Page link* column makes an attribute a link, and an *Expression* column computes its value.
  * **List:** one line per result, from a template your space defines under `templates.*` (such as tasks with their checkbox), or a *Custom template…* you write with the attributes as `${name}`.
* **Limit:** how many results you’d like to show.

Changing the tag, or a change that leaves a filter or column without its attribute, offers to undo it.

## Using the query
The bar at the bottom shows the query (at least part of it).

* **Insert at cursor** puts the `${query[[…]]}` in the page you’re editing, or where you typed `/Query…`. For a query you opened from a page, it’s **Update page**, which replaces that query, and keeps doing so as you change it further.
* **Copy** copies it.
* **Run in Console** runs it in the [[Workbench/Console|Console]], where you can look at its result as Lua values.

## Editing a query on a page
To change a `${query[[…]]}` already on a page, choose *Edit in query builder* from its widget’s menu, or put the cursor in it and run ${widgets.commandButton("Workbench: Edit Query")}. This is best effort: not every handwritten query can be represented by the visual builder. Editing and inserting queries requires a writable page. For a complete exercise in your own space, follow [[Guide/Add Structure and Query]].

# Schema
The Schema view lists the tag's attributes: the ones its schema declares, and the ones found by looking at up to 500 of its objects. For each it shows:

* **Attribute** and **Type**: the [[Schema|JSON Schema]] type (`string`, `number`, `integer`, `boolean`, `array`, `object`, `null`), a format such as `date`, allowed values (*enum*), a reference to another tag (*ref*), or a list of tags or `@names` (*tags*, *identities*). *allow empty* also accepts the attribute left empty, such as `due:` with nothing after it (a `null` value). That's separate from **Required**, which says whether the attribute must be there at all. Rules the editor can't show as simple controls (an `anyOf` of different types, say) offer *Edit as Lua*, also in every row's ⋯ menu: the rule as a Lua table or `schema.*` helpers, read back without running it.
* **Description** and **Required**.
* **Present**: how many of the sampled objects have a value. A partial count opens the objects without it. A ⚠ *invalid* count opens the objects whose value doesn't match, and an allowed value opens the objects that have it.
* **Origin**: *inherited* from the root tag (a `#book` page has `name` because it's a page), *declared* in a definition elsewhere, *local* to your changes here, or *inferred* from the objects.

Edit any of them in place, add attributes with *Add attribute*, and remove or reset them from a row's ⋯ menu, then click **Save and apply** (or press `Mod-s`). Changes stay pending, also when you switch tags or close the Workbench, until you save or discard them; the tab shows a • meanwhile. *Copy as tag.define* copies the schema as Lua, and the icon button picks the tag's icon (or *No icon*). For a schema defined elsewhere, the toolbar links to the page that defines it.

For a tag without a schema, tick the inferred attributes to keep and click **Create schema**. Nothing is required until you say so.

Renaming or removing an attribute changes only the schema, never your pages: an attribute you removed shows up again as inferred while objects still have it.

## Where schemas are saved
The Data tab saves to its own block in your [[^Library/Config]], marked `-- managed-by: workbench-schemas`, next to the block the [[Workbench/Configuration|Configuration]] tab keeps. It's ordinary [[Space Lua]] you can read and edit:

* A schema created here is a `tag.define`.
* Changes to a schema defined elsewhere, such as adding an attribute to `page` or to a library's tag, are kept as separate `config.set` and `tag.setRequired` calls. The original definition is left alone, so later changes to it still take effect.

The block runs after the built-in tags and your other scripts (`-- priority: -10`). When a script that runs even later replaces a schema, saving says which of your changes it overrides.
