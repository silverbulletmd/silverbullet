Code widgets are a SilverBullet-specific [[Markdown/Extensions|extension]] to [[Markdown]]. Technically, it’s not an extension — it just gives new meaning to markdown’s native fenced code blocks — code blocks that start with a triple backtick, specifying a programming language.

Currently, SilverBullet provides a few code widgets out of the box:

* `toc`: [[Table of Contents]]
* `query`: [[Live Queries]]
* `template`: [[Live Templates]]
* `embed`
* `markdown`

In addition, plugs like [[Plugs/KaTeX]] and [[Plugs/Mermaid]] add additional ones.

## `embed`
This allows you to embed internet content into your page inside of an iframe. This is useful to embed youtube videos or other websites.
and a YouTube video: 

```embed
url: https://youtu.be/BbNbZgOwB-Y
```

Note, there is specific support for YouTube videos — it automatically sets the width and height, and replaces the URL with an embed URL.

The body of an `embed` block is written in [[YAML]] and supports the following attributes:

* `url` (mandatory): the URL of the content to embed
* `height` (optional): the height of the embedded page in pixels
* `width` (optional): the width of the embedded page in pixels
