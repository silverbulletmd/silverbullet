#level/beginner

These can be used in text to assign an [[Objects#tag]]. If hashtags are the only content of first paragraph, they are applied to the entire page.

Hashtags can contain letters, dashes, underscores and other characters, but not:
- Whitespace (space, newline etc.)
- Characters from this list: `!@#$%^&*(),.?":{}|<>\`
- Consist of digits only like #123

If you need your tags to contain these characters, you have to surround the tag content with angle brackets like this: #<my tag>

```query
tag where page = @page.name
```