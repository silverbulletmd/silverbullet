The Language API provides functions for parsing code in various programming languages and listing supported languages.

## Language Operations

### language.parse_language(language, code)
Parses a piece of code using any of the supported SilverBullet languages.

Example:
```lua
local code = [[
function hello() {
    console.log("Hello, world!");
}
]]

local tree = language.parse_language("javascript", [[
function hello() {
    console.log("Hello, world!");
}
]])
print("Parsed syntax tree:", tree)
```

### language.list_languages()
Lists all supported languages in fenced code blocks.

Example:
${language.list_languages()}