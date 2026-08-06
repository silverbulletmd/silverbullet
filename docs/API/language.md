---
tags: api/syscall
references:
- plug-api/syscalls/language.ts
- client/plugos/syscalls/language.ts
---

The Language API provides functions for parsing code in various programming languages and listing supported languages.

<!--#lua spacelua.renderApiDocumentation("language") -->
## language.listLanguages

`language.listLanguages()`

Lists all supported fenced-code-block languages.

**Returns:**

- `table` — Supported language names.

**Example:**

```lua
local languages = language.listLanguages()
```

## language.parseLanguage

`language.parseLanguage(language, code)`

Parses code using a supported fenced-code-block language.

**Parameters:**

- `language` (`string`) — Language name or alias.
- `code` (`string`) — Source code to parse.

**Returns:**

- `table` — Parsed syntax tree.

**Example:**

```lua
local tree = language.parseLanguage("javascript", "const answer = 42")
```
<!--/lua-->

