YAML stands for “YAML Ain’t Markup Language.” More information can be found at [the YAML website](https://yaml.org/).

SilverBullet uses YAML in various contexts, specifically [[Frontmatter]] and [[Space Config]]

# Internal links
Many string values can be written directly in YAML without any quoting, like:
```yaml
property: value
```

However when you want to reference [[Links|a page]] or [[Command links|command]] you will need to quote the full link:
```yaml
some page: "[[Pages]]"
list of pages:
  - "[[Pages]]"
  - "[[Links]]"
```

This is because the square brackets used in the internal link format have a meaning in YAML as well. So an unquoted link is parsed as list inside a list:
```yaml
some page: [[Pages]]
equivalent yaml: [
    [ "Pages" ]
]
```
