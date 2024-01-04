---
tags: template
type: frontmatter
selector: 'tags = "plug"'
---
{{#if author}}This page documents a [[Plugs|plug]] created by **{{author}}**. [Repository]({{repo}}).{{else}}This page documents a [[Plugs|plug]] built into SilverBullet.{{/if}}
{{#if shareSupport}}_This plug supports [[Plugs/Share]]_{{/if}}