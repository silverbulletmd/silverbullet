---
description: Adds Linked Mentions to pages
tags: template
hooks.bottom.where: 'true'
---
{{#let @linkedMentions = {link where toPage = @page.name and page != @page.name order by page}}}
{{#if @linkedMentions}}
# Linked Mentions
{{#each @linkedMentions}}
* [[{{ref}}]]: “{{snippet}}”
{{/each}}
{{/if}}
{{/let}}
