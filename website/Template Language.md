SilverBullet uses a simple template language for [[Templates]] that is somewhat inspired by [Handlebars](https://handlebarsjs.com/).

A template is regular [[Markdown]] text with a few _directives_ wrapped between `{{` and `}}`.

Examples on this page will use the [[Live Templates#Block]] feature. To see the underlying code, move your cursor inside the block or click the edit button that will appear when you hover over the block.

# Expressions
[[Expression Language]] expressions can be injected in a template using the `{{expression}}` syntax.

> **note** Note
> For handlebars backwards compatibility, a legacy function call syntax is added, although we don’t recommend using it (use the [[Expression Language#Function calls]] syntax instead).
> This syntax looks as follows: `{{escape "hello"}}` (note the lack of parentheses).

## Examples
```block
3 * 3 = {{3 * 3}}
```

# let directive
To define a variable, you can you use a `#let` directive. The variable will be scoped to the directive.

```block
{{#let @myVar = 3 * 3}}
3 * 3 from a variable: {{@myVar}}
{{/let}}
And here it is {{@myVar}} again
```

# if directive
To conditionally render a part of a template use an `#if` directive:

```block
{{#if 8 > 3}}
8 is larger than 3
{{/if}}
```

You can also add an optional `else` clause:

```block
{{#if 8 > 3}}
8 is larger than 3
{{else}}
8 is smaller than 3
{{/if}}
```

# each directive
To iterate over a collection use an `#each` directive. On each iteration, the current item that is iterated over will be set as the active object (accessible via `.` and its attributes via the `attribute` syntax):

```block
Counting to 3:
{{#each [1, 2, 3]}}
* {{.}}
{{/each}}

Iterating over the three last modified pages:
{{#each query("page order by lastModified desc limit 3")}}
* {{name}}
{{/each}}
```
