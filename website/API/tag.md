#api/space-lua #maturity/experimental

Enables customization of [[Tag|tags]] and its [[Object|objects]] in a few ways:

* Restrict and validates [[Metadata]] against a [[Schema]]
* Change how objects are indexed in the [[Object Index]]
* Tweak styling of tags in the editor using [[Space Style]]

# API
## tag.define(spec)
Defines a tag explicitly.

`spec` is a table that can contain:
* `name` (required) the name of the tag
* `metatable` to set a custom Lua metatable for objects with this tag.
* `mustValidate` a boolean defining whether or not schema validation must pass for the object to be indexed
* `schema` [[Schema]] to validate against
* `validate` callback function invoked when an objects needs to be validated, returns `nil` or an error message.
* `transform` callback function invoked when an object with tag `name` has been indexed. Allows you to make changes to it, skip indexing altogether or generate additional objects.

When `tag.define` is called multiple times with the same `name`, the specs will be merged. This e.g. enables overriding the schema of a built-in tag, or augment it with a custom `transform` callback.

This is a very powerful API, with a wide range of potential use cases.

# Use cases
## Schema validation
To define a [[Schema]] for validating an object (e.g. a page) tagged with `#person` ensuring that the `age` attribute is always a number, you can do the following:
```lua
tag.define {
  name = "person",
  -- mustValidate = true,
  schema = {
    type = "object",
    properties = {
      age = schema.number()
    }
  }
}
```
**Effect:** When editing a page tagged with `#person` where this schema does not validate (e.g. you set the `age` to be a string), you will see this error being highlighted in the editor.

If you set `mustValidate` to `true`, schema validation will happen during the index phase (in addition to linting in the editor) and non-validating objects will not be indexed (with errors being reported in the JavaScript console). Use this to ensure all your objects conform to your schema (it does come at a slight performance penalty at the indexing phase). Errors are reported to the [[Log]].

## Index augmentation
Based on your page’s markdown, an indexer produces a list of objects to be indexed. If you define a `transform` callback function for a tag, this function will be invoked for each object with that tag, when the indexer encounters one. `transform` can inspect the object and do a few things:

* Make changes to the object in place and return it: this is the most common scenario. It allows you to attach additional attributes to the object before it's persisted to the database.
* Return an empty table (`{}`): in this case the object will not be indexed at all.
* Return `nil` in which case indexing proceeds as usual.
* Return a list of objects that should be indexed _instead_: this may include the original object or a modification of it. This allows you to generate a set of custom objects, e.g. based on further parsing of the data in the object. A use case here could be to extract additional attributes from an existing attribute.
  **Note:** one of the returned objects _must_ have the same `ref` attribute as the object passed in.

> **warning** Warning
> For custom `transform` functions to be picked up during the initial client indexing phase they **have to be defined** in your [[CONFIG]] page.

> **note** Note
> `transform` will only be invoked when a page is indexed. This generally happens after making a change. To apply newly defined `transform` functionality to all pages in your space, you have to reindex the entire space using `Space: Reindex`.

### Example: adding [[Page Decorations]] dynamically
The following dynamically adds a 🧑 prefix [[Page Decorations|page decoration]] to all pages tagged with `#person`, such as [[Person/John]] and [[Person/Zef]].

```lua
tag.define {
  name = "person",
  transform = function(o)
    o.pageDecoration = { prefix = "🧑 " }
    return o
  end
}
```

### Example: a ‘deadline’ attribute for tasks
Let’s say that you’d like the encode a deadline attribute for tasks without using the `[deadline: "2026-12-31"]` syntax, instead you’d like to use an emoji as follows:

* [ ] Hello 📅 2026-12-31

In addition:

We’d like to highlight tasks that use a 📅 but then don’t follow the correct date format, like here:

* [ ] Hello task 📅 31-12-2026

And we’d like the `name` attribute to be cleaned from the deadline syntax.

This can be implemented by defining a custom `transform` for tasks:
 
```lua
local deadlinePattern = "📅%s*(%d%d%d%d%-%d%d%-%d%d)"

tag.define {
  name = "task",
  validate = function(o)
    if o.name:find("📅") then
      if not o.name:match(deadlinePattern) then
        return "Found 📅, but did not match YYYY-mm-dd format"
      end
    end
  end,
  transform = function(o)
    -- Use a regular expression to find a deadline
    local date = o.name:match(deadlinePattern)
    if date then
      -- Remove the deadline from the name
      o.name = o.name:gsub(deadlinePattern, "")
      -- And put it in as attribute
      o.deadline = date
    end
    return o
  end
}
```

The result is the following:
${query[[
  from t = tags.task
  where t.deadline
  select table.select(t, "name", "done", "deadline")
]]}

## Styling
Tags get assigned a `data-tag-name` attribute in the DOM, which you can use to do custom styling with [[Space Style]].

### Example: colorful tags
Example: #my-red-tag

```space-style
a[data-tag-name="my-red-tag"] {
  background-color: red;
}
```
