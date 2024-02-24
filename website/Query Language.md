The syntax of queries is inspired by [SQL](https://en.wikipedia.org/wiki/SQL). It can be used using [[Live Queries]] as well as via nested queries part of template expressions: [[Expression Language#Queries]].

Let’s start with a query that demonstrates some of the supported clauses. Hover over the result and click the edit icon to show the code that generates the view:

```query
page
order by lastModified desc
where size > 100
select name
limit 10
render [[Library/Core/Query/Page]]
```

It’s most convenient to use the `/query` [[Snippets|snippet]] to insert a query in a page.

A query is formulated specifying a `querySource` followed by a number of clauses that modify or restrict the result set. If you haven’t already, check out how [[Objects]] work in SilverBullet.

Every time `<expression>` is referenced here, an expression using the [[Expression Language]] can be used.

# Clauses
## where <expression>
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
person where page = @page.name and age > 21
```

## order by <expression>
To sort results, an `order by` clause can be used, optionally with `desc` to order in descending order (ascending is the default):

```query
person where page = @page.name order by age desc
```

## limit <expression>
To limit the number of results, you can use a `limit` clause:

```query
person where page = @page.name limit 1
```

## select
You can use the `select` clause to select only specific attributes from the result set. You can use it either simply as `select attribute1, attribute2` but also select the value of certain expressions and give them a name, even one containing spaces using the backtick identifier syntax:

```query
person
where page = @page.name
select name, age, age + 1 as `next year`
```

## render each <template> and render all <template>
In the context of [[Live Queries]], by default, results are rendered as a table. To instead render results using [[Templates|a template]], use the `render` clause, which comes in two shapes `render each` where the template is instantiated for _each_ result (the `each` keyword is optional):

```query
person
where page = @page.name
render each [[internal-template/person]]
```

And `render all` where the entire result set is passed to the template as a list so the template can do its own iteration using `#each`, which you could then use to e.g. build a table (using this [[internal-template/people]] template, for instance):

```query
person
where page = @page.name
render all [[internal-template/people]]
```
