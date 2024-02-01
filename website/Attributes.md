Attribute syntax can contribute additional [[Metadata]] to various [[Objects]], including:

* Pages
* Items
* Tasks

## Syntax
The syntax is as follows:

```
[attributeName: value]
```

For Obsidian/LogSeq compatibility, you can also double the colon like this: `[attributeName:: value]`
 
Attribute names need to be alpha-numeric. Values are interpreted as [[YAML]] values. So here are some examples of valid attribute definitions:

* string: [attribute1: sup]
* number: [attribute2: 10]
* array: [attribute3: [sup, yo]]

Multiple attributes can be attached to a single entity, e.g. like so:

* Some item [attribute1: sup][attribute2: 22]

## Scope
Depending on where these attributes appear, they attach to different things. For instance, this attaches an attribute to a page:

[pageAttribute: hello]

However, usually, [[Frontmatter]] is used for this purpose instead.

Example query:

```query
page where name = @page.name select name, pageAttribute 
```

This attaches an attribute to an item:

* Item [itemAttribute: hello] #specialitem

Example query:

```query
specialitem where itemAttribute = "hello" select name, itemAttribute 
```

This attaches an attribute to a task:

* [ ] Task [taskAttribute: hello]

Example query:

```query
task where page = "Attributes" and taskAttribute = "hello" select name, taskAttribute 
```
