Live Embeds allow you to embed internet content into your page inside of an iframe. This is useful to embed youtube videos or other websites.

```embed
url: https://youtu.be/8btx9HeuZ4s
```

Note, there is specific support for YouTube videos — it automatically sets the width and height, and replaces the URL with an embed URL.

The body of an `embed` block is written in [[YAML]] and supports the following attributes:

* `url` (mandatory): the URL of the content to embed
* `height` (optional): the height of the embedded page in pixels
* `width` (optional): the width of the embedded page in pixels
