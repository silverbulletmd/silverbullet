We would like to keep our space clean, these are some tools that help you do that.

# Broken links
This shows all internal links that are broken.

```template
query: |
  link where toPage and pageExists(toPage) = false
template: |
   {{#if .}}
   {{#each .}}
   * [[{{ref}}]]: broken link to [[{{toPage}}]]
   {{/each}}
   {{else}}
   No broken links, all good!
   {{/if}}
```

# Conflict copies
These are pages that have conflicted copies (as a result of sync), have a look at them as well as their original (non-conflicted versions) and decide which one to keep.

```template
query: |
  page where name =~ /\.conflicted\.\d+$/ 
  select
    name as conflictedName,
    replace(name, /\.conflicted\.\d+$/, "") as cleanName
template: |
   {{#if .}}
   {{#each .}}
   * [[{{cleanName}}]]: confict copy [[{{conflictedName}}]]
   {{/each}}
   {{else}}
   No conflicting pages!
   {{/if}}
```
