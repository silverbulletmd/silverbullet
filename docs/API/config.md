---
tags: api/syscall
references:
- plug-api/syscalls/config.ts
- client/plugos/syscalls/config.ts
- client/config.ts
- plugs/configuration-manager/configuration.ts
---

The Config API provides functions for managing configuration values, defining their JSON schemas, and exposing them in the [[Configuration Manager]] UI.

${spacelua.renderApiDocumentation("config")}

## Configuration Manager guide

Schemas registered through `config.define` support two extensions on top of plain JSON Schema:

* `default`: when present, the value is automatically applied if the key is not already set.
* `ui`: optional annotations that expose the field in the [[Configuration Manager]].

### `ui` annotations

Only fields that have a `ui` attribute appear in the [[Configuration Manager]]. Recognized properties:

* `category` (required): name of the category (tab) the field appears under. It should match a `config.defineCategory` name; otherwise the category appears at the bottom in alphabetical order.
* `label`: human-readable label shown next to the control.
* `priority`: number used to sort fields within a category in descending order. Fields without a priority sort as `0`.
* `inputType`: for `string` fields, set this to `"password"` to render a masked input.

The control shown depends on the schema `type`:

* `boolean`: checkbox
* `string` with `enum`: dropdown
* `string`: text input, or password input when `ui.inputType` is `"password"`
* `number`: number input
* Anything else: a "Configure manually in CONFIG" hint; the user must edit the [[CONFIG]] page directly

The field's `description` is shown as helper text below the label.

Nested schemas can carry their own `ui` annotations. When a parent object's children all have `ui` set, the parent itself is skipped and each child appears as an individual field. This is how related options such as `smartQuotes.double.left` and `smartQuotes.double.right` become separate rows in the same category.

### Categories

Registered categories appear in descending `priority`, with higher values first. A category's optional `description` appears at the top of the category. Categories referenced by a schema but never registered appear after registered categories in alphabetical order.
