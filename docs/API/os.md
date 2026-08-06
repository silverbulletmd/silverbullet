---
tags: api/lua
references:
- client/space_lua/stdlib/os.ts
---

The `os` namespace provides date, time, and clock functions.

## Date formats

`os.date` accepts ISO C `strftime`-style format strings. Prefix the format with `!` to use UTC, or use `*t` (and `!*t` for UTC) to return a table of date fields.

- `%Y`: full year
- `%y`: year without century
- `%m`: month from 01 through 12
- `%b` and `%B`: abbreviated and full month names
- `%d` and `%e`: zero-padded and unpadded day of month
- `%H` and `%I`: 24-hour and 12-hour hour
- `%M`: minute
- `%S`: second
- `%p`: AM or PM
- `%A` and `%a`: full and abbreviated weekday names
- `%w`: weekday from 0 through 6, with Sunday as 0
- `%U` and `%W`: week of year starting on Sunday or Monday
- `%V`: ISO 8601 week of year
- `%j`: day of year
- `%Z` and `%z`: time zone name and UTC offset
- `%%`: literal percent sign

<!--#lua spacelua.renderApiDocumentation("os") -->
## os.clock

`os.clock()`

Returns a high-resolution elapsed time value in seconds.

**Returns:**

- `number` — Browser performance timer in seconds.

## os.date

`os.date(format?, timestamp?)`

Formats a timestamp as a date string or date table, optionally in UTC.

**Parameters:**

- `format?` (`string`) — `strftime`-style format, `*t` for a table, and optional leading `!` for UTC.
- `timestamp?` (`number`) — Unix timestamp; defaults to the current time.

**Returns:**

- `string|table` — Formatted date or date fields.

**Example:**

```lua
print(os.date("%Y-%m-%d"))
local utc = os.date("!*t")
```

## os.difftime

`os.difftime(t2, t1)`

Returns the difference in seconds from timestamp `t1` to `t2`.

**Parameters:**

- `t2` (`number`)
- `t1` (`number`)

**Returns:**

- `number` — The value `t2 - t1` in seconds.

## os.time

`os.time(): integer`
`os.time(dateTable): integer`

Returns the current Unix timestamp or one built from a local date table.

**Parameters:**

- `dateTable?` (`table`) — Local date fields `year`, `month`, `day`, and optional `hour`, `min`, and `sec`.

**Returns:**

- `integer` — Seconds since the Unix epoch.

**Example:**

```lua
local timestamp = os.time({year = 2020, month = 1, day = 1})
```
<!--/lua-->

