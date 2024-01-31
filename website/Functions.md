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

```template
The current page object: {{json(@page)}}
```

# Space related
## pageExists(name)
Checks if the page `name` exists:

```template
This very page exists: {{pageExists(@page.name)}}
```

## readPage(name)
Read the content of page `name` and return it.

```template
{{readPage("internal/test page")}}
```
