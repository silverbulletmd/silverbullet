---
description: (Template) Insert a `#let` directive
tags: template
hooks.snippet:
  slashCommand: "#let"
  order: 10
---
{{escapeDirective("#let @|^| = ")}}

{{escapeDirective("/let")}}