Attributes can contribute additional [[Metadata]] to various entities:

* Pages
* Items
* Tasks

## Syntax
The syntax for attributes in inspired by [Obsidian’s Dataview](https://blacksmithgu.github.io/obsidian-dataview/annotation/add-metadata/) plugin, as well as [LogSeq](https://logseq.com/)‘s:

```
[attributeName:: value]
```

Attribute names need to be alphanumeric. Values are interpreted as text by default, unless they take the shape of a number, in which case they’re parsed as a number.

Multiple attributes can be attached to a single entity, e.g. like so:

* Some item [attribute1:: sup][attribute2:: 22]

And queried like so:

<!-- #query item where page = "Attributes" and name =~ /Some item/ -->
|name     |attribute1|attribute2|page      |pos|
|---------|---|--|----------|---|
|Some item|sup|22|Attributes|569|
<!-- /query -->


## Scope
Depending on where these attributes appear, they attach to different things. For instance here:

[pageAttribute:: hello]

The attribute attaches to a page, whereas

* Item [itemAttribute:: hello]

it attaches to an item, and finally:

* [ ] Task [taskAttribute:: hello]

Here it attaches to a task.