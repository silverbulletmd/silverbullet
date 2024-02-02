We would like to keep our space clean, these are some tools that help you do that.

# Broken links
This shows all internal links that are broken.

```template
{{#let @brokenLinks = {
  link where toPage and not pageExists(toPage)
}}}
{{#if @brokenLinks}}
{{#each @brokenLinks}}
* [[{{ref}}]]: broken link to [[{{toPage}}]]
{{/each}}
{{else}}
No broken links, all good!
{{/if}}
{{/let}}
```

# Conflict copies
These are pages that have conflicted copies (as a result of sync), have a look at them as well as their original (non-conflicted versions) and decide which one to keep.

```template
{{#let @conflictPages = {
  page where name =~ /\.conflicted\.\d+$/
  select name as conflictedName,
         replace(name, /\.conflicted\.\d+$/, "") as cleanName
}}}
{{#if @conflictPages}}
{{#each @conflictPages}}
* [[{{cleanName}}]]: confict copy [[{{conflictedName}}]]
{{/each}}
{{else}}
No conflicting pages!
{{/if}}
{{/let}}
```
