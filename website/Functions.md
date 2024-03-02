Here is a list of all functions you can use in SilverBullet’s [[Expression Language]]:

# Lists
## count(list)
Count the number of elements in a list:

```template
There are **{{count({page})}}** pages in this space.
```

## at(list, index)
Returns the `index`th element of `list` (starting from 0 of course).

```template
Index 1 of our count to three is {{at([1, 2, 3], 1)}}
```

# Templates
## template(text, value)
Renders a template with an optional value:

```template
{{template([[Library/Core/Query/Page]], {"name": "Some page"})}}
```


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

This function supports an infinite number of replacements, so you can keep adding more, e.g. `replace(str, match1, replacement1, match2, replacement2, match3, replacement3)`

## contains(str, substr)
Returns whether `str` contains `substr` as a substring.

## json(obj)
Convert the argument to a JSON string (for debugging purposes).

```template
The current page object: {{json(@page)}}
```

# Space related
## pageExists(name)
Checks if the page `name` exists:

```template
This very page exists: {{pageExists(@page.name)}}

And this one: {{pageExists("non-existing")}}
```

## readPage(name)
Reads in the content of the page `name` and returns it as a string.