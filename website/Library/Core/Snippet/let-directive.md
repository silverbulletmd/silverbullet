---
description: (Template) Insert a `#let` directive
tags: template
hooks.snippet:
  slashCommand: "#let"
  order: 10
  onlyContexts:
  - FencedCode:template
---
{{escapeDirective("#let @|^| = ")}}

{{escapeDirective("/let")}}