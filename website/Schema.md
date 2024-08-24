#level/hardcore

> **warning** Warning
> This feature is **experimental**, it may evolve over time.

SilverBullet allows you to define schema for custom [[Space Config]] settings as well as for [[Objects|object]] [[Tags|tags]]. Both are defined using [[Space Config]] and use a [[YAML]] encoding of [JSON Schema](https://json-schema.org/).

# Object Schemas
The general format to define schemas for specific [[Tags]] is as follows:

~~~
```space-config
schema.tag.<<TAG>>: <<JSON SCHEMA ENCODED AS YAML>>
```
~~~

## Example
Let’s say you use pages tagged with `#contact` to represent your contacts:

```template
{{#each {contact}}}
* [[{{name}}]] ([{{email}}](mailto:{{email}})):
  * First name: _{{firstName}}_
  * Last name: _{{lastName}}_
{{/each}}
```

To ensure you always attach the required meta data in [[Frontmatter]] for your contacts, you’d like to do some checking. Specifically you would like to enforce that:

* `firstName` should always be a `string` and is _required_
* `lastName` should always be a `string` and is _required_
* `email` should be an e-mail address, if specified

You can achieve this using the following [[Space Config]]:

```space-config
schema.tag.contact:
  properties:
    firstName.type: string
    lastName.type: string
    email:
      type: string
      format: email
  required:
  - firstName
  - lastName
```

> **note** Note
> To reload changes to your schema, be sure to run {[System: Reload]}

# Config schema
[[Space Config]] allows you to define arbitrary configuration keys for your own use cases. This is primarily useful for [[Libraries]], but perhaps you find your own use cases too.

The general format is:

~~~
```space-config
schema.config: <<JSON SCHEMA ENCODED AS YAML>>
```
~~~

## Example
Let’s say you find it useful to make your full name globally configurable:

```space-config
myFullName: "Steve Hanks"
```

This can be useful, because you can reference this configuration key in any query or template, e.g.:

```template
My full name is: {{@config.myFullName}}
```

However, you would like to make sure that this `myFullName` configuration is always a string. You can achieve this with the following config schema definition:

```space-config
schema.config.properties.myFullName.type: string
```

Now, if you would accidentally change `myFullName` into a number or boolean value, you would get a validation error.

# Validation
Validation happens during linting in the editor (visually, with squiggly lines for errors) and indexing (at the database level). Therefore, changes to your schema will only go into effect when either of those two things kick in.

For pages, during indexing, specified [[Frontmatter]] is validated against schema specified for its tags. If validation fails for one of these tags, that _tag will be removed_ from its `tags` attribute and therefore **not** be indexed as such. This guarantees that the schema is enforced and any object follows the schema.

For instance, in the example mentioned in [[#Example]], if the `lastName` of either of the two `#contact` tagged pages is removed (which would mean it no longer matches the schema constraints), this object will no longer be indexed as a `contact` and thus not appear in query results for it. However, since the page still follows the regular `page` tag schema, it will still appear in `page` query results.

> **note** Note
> If you would like to enforce a newly introduced or updated schema on your entire space, you will have to run a full {[Space: Reindex]}.

# Supported types
All standard JSON Schema types are supported. Likely you are interested in:
* `string`
  * With custom formats (specified via `format`):
    * `email`
    * `page-ref` (for page references, e.g. `[[something]]`)
* `number`
* `array`
* `object`