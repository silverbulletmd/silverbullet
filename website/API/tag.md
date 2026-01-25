#api/space-lua #maturity/experimental

Provides APIs to define and configure custom [[Tag|Tags]].

Enables you to customize tags in a few ways:

* Define a [[Schema]] for your tag, which is used to validate objects with your custom tag (and to offer auto complete in the future) and show validation errors in the editor ([[Frontmatter]] only)
* Define how parts of your tags are indexed.
* Tweak styling of tags in the editor using [[Space Style]]

# API
## tag.define(spec)
Defines a custom tag. `spec` is a table that can contain:
* `name` (required) the name of the tag
* `mustValidate` a boolean defining whether or not schema validation must pass for the object to be indexed
* `schema` [[Schema]] to validate against
* `postProcess` callback function invoked when an object with tag `name` has been indexed. Allows you to make changes to it, skip indexing altogether or generate additional objects

# Use cases
## Schema validation
To define a JSON schema for validating an object (e.g. a page) tagged with `#person` ensuring that the `age` attribute is always a number, you can do the following:
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
The result of this is that when editing a page tagged with `#person` where this schema does not validate, you will see this error being highlighted.

If you set `mustValidate` to `true`, schema validation will happen during the index phase (in addition to linting in the editor) and non-validating objects will not be indexed (with errors being reported in the JavaScript console). Use this to ensure all your objects conform to your schema (it does come at a slight performance penalty at the indexing phase).

## Post processing
Based on your page’s markdown, an indexer produces a list of objects to be indexed. If you define a `postProcess` callback function for a custom tag, this function will be invoked with objects with that tag when the indexer encounters them. `postProcess` can inspect the object and do a few things:

* Make changes to the object and return it: this is the most common scenario. It allows you to attach additional attributes to the object before it's persisted to the database.
* Return an empty table (`{}`): in this case the object will not be indexed at all.
* Return a list of objects that should be indexed instead: this may include the original object or a modification of it. This allows you to generate a set of custom objects, e.g. based on further parsing of the data in the object. A use case here could be to extract additional attributes from an existing attribute.

> **note** Note
> `postProcess` will only be invoked when a page is indexed. This generally happens after making a change. To apply newly defined `postProcess` functionality to all pages in your space, you have to reindex the entire space using `Space: Reindex`.

### Example: adding [[Page Decorations]]
The following dynamically adds a 🧑 prefix [[Page Decorations|page decoration]] to all pages tagged with `#person`, such as [[Person/John]] and [[Person/Zef]].
```space-lua
tag.define {
  name = "person",
  postProcess = function(o)
    o.pageDecoration = { prefix = "🧑 " }
    return o
  end
}
```

## Styling
Tags get assigned a `data-tag-name` attribute in the DOM, which you can use to do custom styling with [[Space Style]].

Example: #my-red-tag

```space-style
a[data-tag-name="my-red-tag"] {
  background-color: red;
}
```
