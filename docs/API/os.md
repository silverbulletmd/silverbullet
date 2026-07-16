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

${spacelua.renderApiDocumentation("os")}
