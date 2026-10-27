---
description: "Browse space objects and build, preview and insert Space Lua queries."
references:
- client/workbench/query/**
---
The Query tab shows the objects in your space: your pages, tasks, and everything you tagged. Pick a tag to look through its objects, and use the query editor beside them to narrow them down, sort or group them, or pick what to show: it builds a query without you having to know the query syntax.

${widgets.commandButton("Workbench: Query")} opens this tab in the [[Workbench]].

The tab has three parts:

* **Tags**: the [[Tag|tags]] SilverBullet indexes itself, grouped by kind: **Root** tags such as `page` and `task`, then edge and index tags, then the **User tags** used in your space. 
* **The query editor**: one row per part of the query, named after the keyword it writes.
* **The results**: rendered the way the query renders on a page (or as Lua values). It shows the first 200 rows of a large result.

# Building a query
* **From:** the [[Tag]] you want to query.
* **Where:** filters, all of which must match:
  * *+ Filter* picks an attribute, then an operator that suits its type.
  * *+ Expression* takes any Lua condition.
* **Group By:** one result per distinct value of an attribute (or combination of attributes). The **Select** row then shows group columns: each is a group key or an aggregate of an attribute, like `count` or `avg`, including your own [[Space Lua/Integrated Query/Aggregating|aggregates]].
* **Order By:** the order, with directions named for the attribute’s type (*earliest first*, *A–Z*, *high to low*). Click an order to flip it. While grouping, you order by a group key or an aggregate column.
* **Select:** what each result shows.
  * **Table** (the default): a column per attribute the objects have. Remove, rename and reorder columns, or *Clear all* to start from none; a *Page link* column makes an attribute a link, and an *Expression* column computes its value.
  * **List:** one line per result, from a template your space defines under `templates.*` (such as tasks with their checkbox), or a *Custom template…* you write with the attributes as `${name}`.
* **Limit:** how many results you’d like to show.

# Attributes
Attributes come from the tag’s [[Schema]] when it has one, and from looking at up to 500 of its objects, which also finds attributes a schema leaves out. For each attribute, **Schema** shows its type, where it came from (*built-in*, *declared* or *inferred*), how many objects have it, and some of its values.

For a tag without a schema, the type is worked out from the values: dates, page links and numbers are recognized, and an attribute with a few repeating values becomes *one of* those values, with a dropdown in filters. An attribute with values of different kinds is marked *mixed*. *Copy as tag.define* copies the attributes as a `tag.define` you can paste into a `space-lua` block to give the tag a declared schema.

Changing the tag, or a change that leaves a filter or column without its attribute, offers to undo it.

# Using the query
The bar at the bottom shows the query (at least part of it).

* **Insert at cursor** puts the `${query[[…]]}` in the page you’re editing, or where you typed `/Query…`. For a query you opened from a page, it’s **Update page**, which replaces that query, and keeps doing so as you change it further.
* **Copy** copies it.
* **Run in Console** runs it in the [[Workbench/Console|Console]], where you can look at its result as Lua values.

# Editing a query on a page
To change a `${query[[…]]}` already on a page, choose *Edit in query builder* from its widget’s menu, or put the cursor in it and run ${widgets.commandButton("Workbench: Edit Query")}. This is “best effort” not every query can be reverse-engineered to a query editable in the Query Workbench.