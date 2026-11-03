---
tags: api/syscall
references:
- plug-api/syscalls/yaml.ts
- plug-api/lib/yaml.ts
- plugs/index/yaml.ts
---
Parse YAML text and serialize values as YAML.

<!--#lua spacelua.renderApiDocumentation("yaml") -->
## yaml.parse
`yaml.parse(text)`

Parses a YAML string into a Lua value.

**Parameters:**

- `text` (`string`) — YAML source text.

**Returns:**

- Value — Parsed YAML value.

## yaml.stringify
`yaml.stringify(value)`

Serializes a Lua value as YAML text.

**Parameters:**

- `value` — Value to serialize.

**Returns:**

- `string` — YAML representation of the value.
<!--/lua-->

