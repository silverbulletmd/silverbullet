SilverBullet uses a template language for [[Templates]] that is partially inspired by [Handlebars](https://handlebarsjs.com/), however adds some powerful new features — primarily a much more expressive [[Expression Language]].

The template language is a superset of [[Markdown]] text a new _directive syntax_ added, using `{{` and `}}`.

Examples on this page will use the [[Live Templates#Template]] feature. To see the underlying code, move your cursor inside the block or click the edit button that will appear when you hover over the block.

# Expressions
[[Expression Language]] expressions can be inject in a template using the `{{expression}}` syntax.

There’s some “smarts” built into this:
* When the expression evaluates to a scalar value, such as a string, number or boolean, this value will just be presented as is.
* When the expression evaluates to an _array of objects_ (such as the result of a query), they will be rendered as a markdown table.
* When the expression evaluates to a single simple object, this value will be rendered in a single-row markdown table.
* Any other complex value will be rendered as JSON.

## Examples
```template
A simple value: {{20 * 3}}

A list of objects:
{{{page limit 2}}}

Note that if we include a `render` clause in a query, it will evaluate to a string and therefore also render properly:
{{{page limit 2 render [[Library/Core/Query/Page]]}}}

A single object:
{{at({page limit 1}, 0)}}

Any other random value:
{{[1, 2, 3]}}
```

# let directive
To define (scoped) variables, you can you use a `#let` directive. The variable will be scoped to the directive. Variables in [[Expression Language]] use the `@variable` syntax:

```template
{{#let @myVar = 3 * 3}}
3 * 3 from a variable: {{@myVar}}
{{/let}}
And here it is {{@myVar}} again
```

# if directive
To conditionally render a part of a template use an `#if` directive:

```template
{{#if 8 > 3}}
8 is larger than 3
{{/if}}
```

You can also add an optional `else` clause:

```template
{{#if 8 > 3}}
8 is larger than 3
{{else}}
8 is smaller than 3
{{/if}}
```

# each directive
To iterate over a collection use an `#each` directive. There are two variants of `#each`, one with and one without variable assignment:

* `#each @varname in expression` repeats the body of this directive assigning every value to `@varname` one by one
* `#each expression` repeats the body of this directive assigning every value to `.` one by one.

```template
Counting to 3 with a variable name:
{{#each [1, 2, 3]}}
* {{.}}
{{/each}}

And using a variable name iterator:
{{#each @v in [1, 2, 3]}}
* {{@v}}
{{/each}}

Iterating over the three last modified pages:
{{#each {page order by lastModified desc limit 3}}}
* {{name}}
{{/each}}
```
