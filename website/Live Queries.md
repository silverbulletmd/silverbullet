Live Queries enable a (quasi) live view on various data sources, usually [[Objects]], and renders their results inline via [[Live Preview]] either as a template or using [[Templates]].

# Syntax
The syntax of live queries is inspired by [SQL](https://en.wikipedia.org/wiki/SQL). Below is a query that demonstrates some of the supported clauses. Hover over the result and click the edit icon to show the code that generates the view:
```query
page
order by lastModified desc
where size > 100
select name
limit 10
render [[template/page]]
```
It’s most convenient to use `/query` [[Slash Commands]] to insert a query in a page.

For those comfortable reading such things, [here you can find the full query grammar](https://github.com/silverbulletmd/silverbullet/blob/main/common/markdown_parser/query.grammar).

The general syntax is to specify a `querySource` followed by a number of clauses that modify or restrict. If you haven’t already, check out how [[Objects]] work in SilverBullet.

# Clauses
## `where` [[@expression]]
A `where` clause filters out all objects that do not match a certain condition. You can have multiple `where` clauses if you like, which will have the same effect as combining them with the `and` keyword.

Here is a simple example based on a custom tag `#person` (see [[Objects]] on how this works):

```#person
name: John
age: 7
---
name: Pete
age: 25
```

To query all `person`s that are above age 21, we can use the following `where` clause:

```query
person where page = "{{@page.name}}" and age > 21
```
## `order by` [[@expression]]
To sort results, an `order by` clause can be used, optionally with `desc` to order in descending order (ascending is the default):

```query
person where page = "{{@page.name}}" order by age desc
```
## `limit` [[@expression]]
To limit the number of results, you can use a `limit` clause:

```query
person where page = "{{@page.name}}" limit 1
```
## `select`
You can use the `select` clause to select only specific attributes from the result set. You can use it either simply as `select attribute1, attribute2` but also select the value of certain expressions and give them a name via the `select age + 1 as nextYear` syntax:

```query
person
where page = "{{@page.name}}"
select name, age, age + 1 as nextYear
```

## `render each [[template]]` and `render all [[template]]`
$render
By default, results are rendered as a table. To instead render results using [[Templates|a template]], use the `render` clause, which comes in two shapes `render each` where the template is instantiated for _each_ result (the `each` keyword is optional):

```query
person
where page = "{{@page.name}}"
render each [[template/person]]
```

And `render all` where the entire result set is passed to the template as a list so the template can do its own iteration using `#each`, which you could then use to e.g. build a table (using this [[template/people]] template, for instance):

```query
person
where page = "{{@page.name}}"
render all [[template/people]]
```
# Expressions
$expression

Primitives:

* strings: `"a string"`
* numbers: `10`
* booleans: `true` or `false`
* regular expressions: `/[a-z]+/`
* null: `null`
* lists: `["value 1", 10, false]`

Attributes can be accessed via the `attribute` syntax, and nested attributes via `attribute.subattribute.subsubattribute`.

Logical expressions:

* and: `name = "this" and age > 10`
* or: `name = "this" or age > 10`

Binary expressions:
* `=` equals.
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

Operator precedence follows standard rules, use parentheses when in doubt, e.g. `(age > 10) or (name = "Pete")`
