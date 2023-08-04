Attributes can contribute additional [[Metadata]] to various entities:

* Pages
* Items
* Tasks

## Syntax
The syntax is as follows:

```
[attributeName: value]
```

For Obsidian/LogSeq compatibility, you can also double the colon like this: `[attributeName:: value]`
 
Attribute names need to be alphanumeric. Values are interpreted as [[YAML]] values. So here are some examples of valid attribute definitions:

* string: [attribute1: sup]
* number: [attribute2: 10]
* array: [attribute3: [sup, yo]]

Multiple attributes can be attached to a single entity, e.g. like so:

* Some item [attribute1: sup][attribute2: 22]

## Scope
Depending on where these attributes appear, they attach to different things. For instance, this attaches an attribute to a page:

[pageAttribute:: hello]

Example query:

<!-- #query page where name = "Attributes" -->
|name      |lastModified |contentType  |size|perm|pageAttribute|
|----------|-------------|-------------|----|--|-----|
|Attributes|1691165890257|text/markdown|1609|rw|hello|
<!-- /query -->

This attaches an attribute to an item:

* Item [itemAttribute:: hello]

Example query:

<!-- #query item where page = "Attributes" and itemAttribute = "hello" -->
|name|itemAttribute|page      |pos |
|----|-----|----------|----|
|Item|hello|Attributes|1079|
<!-- /query -->

This attaches an attribute to a task:

* [ ] Task [taskAttribute:: hello]

Example query:

<!-- #query task where page = "Attributes" and taskAttribute = "hello" -->
|name|done |taskAttribute|page      |pos |
|----|-----|-----|----------|----|
|Task|false|hello|Attributes|1355|
<!-- /query -->
