SilverBullet has a simple expression language that is used by the [[Query Language]], [[Template Language]] and `where` condition in [[Live Template Widgets]].

Examples in this page will be demonstrated by embedding expressions inside of a [[Templates|template]].

While a custom language, it takes a lot of inspiration from JavaScript and SQL, but includes some features very specific to SilverBullet, including syntax for embedded queries and page references.

# Primitive values
* strings: `"a string"`, or `'a string'`. Escaping is not currently supported, so use your quotes wisely.
* numbers: `10`
* booleans: `true` or `false`
* regular expressions: `/[a-z]+/`
* null: `null`
* lists: `["value 1", 10, false]`
* objects: `{"name": "Jack", "age": 1232}`
* identifiers: starting with a letter, followed by alphanumerics, `_` or `-`. Identifiers can also be surrounded with backticks: ` and in that case contain any non-backtick characters, including spaces.
* attributes:
  * `.` for the current object
  * `attr` for the current object’s attribute with the name `attr`
  * `<expression>.attr` to access an attribute from the object that `<expression>` evaluates to
* variables: `@page`

## Examples
```template
String expression: {{"This is a string"}} 
List expression: {{[1, 2, 3]}} 
Attribute of variable: {{@page.name}} 
```

# Function calls
* `functionName(argument1, argument2, ...)`: call function `functionName`
* `functionName`: call `functionName` without any arguments

## Examples
```template
Today with argument list: {{today()}}
Today without an argument list: {{today}}
```

## Supported functions
[[Functions]]

# Queries
Expression can include [[Query Language|queries]] using the `{ page limit 1 }` syntax. Queries evaluate to one of two things:

* Queries with a `render` or `render all` clause will evaluate a string, where the referenced template is applied (similar to [[Live Queries]]).
* Queries _without_ a `clause` will evaluate to a list of results.

Note that you can reference variables inside your query as well.

## Example
Incomplete task:
* [ ] This task is not yet complete

```template
Number of incomplete tasks on this page: {{count({task where not done and page = @page.name})}}

A rendered query:
{{{page limit 3 render [[Library/Core/Query/Page]]}}}
```

# Page references
Page references use the `[[page name]]` syntax and evaluate to the content of the referenced page (as a string), this makes them a good candidate to be used in conjunction with [[Functions#template(text, value)]] or to simply inline another page:

```template
Including another page directly, without template rendering: {{[[internal/test page]]}}

And rendered as a template: {{template([[internal/test page]], "actual value")}}
```

# Logical expressions 
* and: `name = "this" and age > 10`
* or: `name = "this" or age > 10`

## Examples
```template
Simple boolean expression: {{"pete" = "pete" or "hank" = "pete"}}
```

# Operators 
* `=` equals
  * For scalar values this performs an equivalence test (e.g. `10 = 10`)
  * If the left operand is an array and the right operand is _not_, this will check if the right operand is _included_ in the left operand’s value, e.g. `[1, 2, 3] = 2` will be true.
  * If both operands are arrays, they will be compared for equivalence ignoring order, so this will be true: `[1, 2, 3] = [3, 2, 1]`
* `!=` the exact inverse of the meaning of `=`, e.g. `name != "Pete"`
* `<` less than, e.g. `age < 10`
* `<=` less than or equals, e.g. `age <= 10`
* `>` greater than, e.g. `age > 10`
* `>=` greater than or equals, e.g. `age >= 10`
* `=~` to match against a regular expression, e.g. `name =~ /^template\//`
* `!=~` to not match a regular expression, e.g. `name !=~ /^template\//`
* `in` member of a list (e.g. `prop in ["foo", "bar"]`)
* `+` addition (can also concatenate strings), e.g. `10 + 12` or `name + "!!!"`
* `-` subtraction, e.g. `10 - 12`
* `/` addition, e.g. `10 / 12`
* `*` multiplication, e.g. `10 * 12`
* `%` modulo, e.g. `10 % 12`
* `not <expression>` or `!<expression>` to negate the truthiness value
* `<expression> ? <ifTrue> : <ifFalse>`

## Operator precedence
Operator precedence follows standard rules, use parentheses when in doubt, e.g. `(age > 10) or (name = "Pete")`

## Examples
```template
Some arithmatic: {{10 * 100 / 1000}}
Some regexp match: {{"hello" =~ /ell/}}
Some list check: {{["template", "other"] = "template"}}
{{8 > 3 ? "8 is larger than 3" : "8 is not larger than 3"}}
```

# Comments
Line comments are supported via `# this is a line comment`
