You can also embed arbitrary YAML data blocks in pages via fenced code blocks and use a tag as a coding language, e.g.

```#contact
name: Pete
age: 55
```

Which then becomes queryable via the `contact` tag:
${query[[from index.tag "contact"]]}
