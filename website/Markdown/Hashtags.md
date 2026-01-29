Hashtag syntax (`#my-tag`) can be used to explicitly assign a [[Tag]] to an [[Object]].

# Scope rules
* If a hashtag is the only content in a paragraph (at most with additional hashtags), it applies to the **page**.
* If a hashtag is used inside of an item (bullet point, or ordered list), it applies to that **item**.
* If a hashtag is used inside of a [[Task]], it applies to that **task**.
* If a hashtag is used inside of a paragraph, they apply to the **paragraph**.
* If you create a [[Markdown/Fenced Code Block]] with a hashtag as language, it applies the tag to that [[Object/data]].

## Examples
#page-tag-example

Paragraph #paragraph-tag-example

* Item #item-tag-example
* [ ] Task #task-tag-example

```#data-example
name: Hank
```

# Naming rules
Hashtags can contain letters, dashes, underscores and other characters, but not:
- Whitespace (space, newline, etc.)
- Characters from this list: `!@#$%^&*(),.?":{}|<>\`
- Digits only (e.g. #123)

If you need your tags to contain these characters, you have to surround the tag content with angle brackets like this: #<my tag>
