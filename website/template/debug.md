---
tags: template
type: query
order: 100
description: |
  Renders its object value in a `key: value` format
usage: |
   Can be used by passing in a YAML object in a template via `value` or in a `render` clause of a query
---
{{#each .}}
{{@key}}: {{.}}
{{/each}}

---