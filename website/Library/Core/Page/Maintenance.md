#meta

We would like to keep our space clean, these are some tools that help you do that.

# Aspiring pages
This shows all page links that link to a page that does not (yet) exist. These could be broken links or just pages _aspiring_ to be created.

```template
{{#let @brokenLinks = {aspiring-page}}}
{{#if @brokenLinks}}
{{#each @brokenLinks}}
* [[{{ref}}]]: broken link to [[{{name}}]]
{{/each}}
{{else}}
No aspiring pages, all good!
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
