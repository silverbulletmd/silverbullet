Here is a list of all functions you can use in SilverBullet’s [[Expression Language]]:

# Lists and queries 
## query(query, ...args)
Perform a [[Query Language]] query. The `query` may contain `?` placeholders, filled in with the args:

```block
Most recently updated page: {{at(query("page order by lastModified desc limit 1"), 0).name}}

Some page query JSON: {{json(query("page limit ?", 8 - 5))}}
```

## count(list)
Count the number of elements in a list:

```block
{{#let @totalTasks = count(query("task"))}}
{{#let @notDoneTasks = count(query("task where not done"))}}
# Fun stats
There are **{{count(query("page"))}}** pages in this space.
You have **{{@totalTasks}}** total tasks of which **{{@notDoneTasks}}** have not been completed. That's like, {{@notDoneTasks/@totalTasks * 100}}% not complete.
{{/let}}
{{/let}}
```

## at(list, index)
Returns the `index`th element of `list`.

# Date and time
## today()
Today’s date in a `YYYY-MM-dd` format.

## tomorrow()
Tomorrow’s date in a `YYYY-MM-dd` format.

## yesterday()
Yesterday’s date in `YYYY-MM-dd` format.

## niceDate(timestamp)
Convert a unix timestamp to a `YYYY-MM-dd` format.

## time()
Current time.

# String manipulation
## replace(str, match, replacement)
Replace text in a string. `match` can either be a literal string or a regular expression: `replace("hello", "ell", "all")` would produce “hallo”, and `replace("hello", /l/, "b")` would produce “hebbo”.

## json(obj)
Convert the argument to a JSON string (for debugging purposes).

```block
The current page object: {{json(@page)}}
```

# Space related
## pageExists(name)
Checks if the page `name` exists:

```block
This very page exists: {{pageExists(@page.name)}}
```

## readPage(name)
Read the content of page `name` and return it.

```block
{{readPage("internal/test page")}}
```
