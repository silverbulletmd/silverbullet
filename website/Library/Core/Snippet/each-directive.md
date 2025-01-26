---
description: (Template) Insert an `#each` directive
tags: template
hooks.snippet:
  slashCommand: "#each"
  order: 10
  onlyContexts:
  - FencedCode:template
---
{{escapeDirective("#each |^|")}}

{{escapeDirective("/each")}}