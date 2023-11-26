Code widgets are a SilverBullet-specific “extension” to [[Markdown]]. Technically, it’s not an extension — it just gives new meaning to markdown’s native fenced code blocks — code blocks that start with a triple backtick, specifying a programming language.

Currently, SilverBullet provides two code widgets as part of its built-in [[🔌 Plugs]]:

* `embed`
* `markdown`

In addition, plugs like [[🔌 KaTeX]] and [[🔌 Mermaid]] add additional ones.

## Embed
This allows you to embed internet content into your page inside of an iframe. This is useful to, for instance, embed youtube videos. In fact, there is specific support for those.

Two examples.

First, embedding the silverbullet.md website inside the silverbullet.md website (inception!):

```embed
url: https://silverbullet.md
height: 500
```

and a YouTube video: 

```embed
url: https://www.youtube.com/watch?v=VemS-cqAD5k
```

Note, there is specific support for YouTube videos — it automatically sets the width and height, and replaces the URL with an embed URL.

The body of an `embed` block is written in [[YAML]] and supports the following attributes:

* `url` (mandatory): the URL of the content to embed
* `height` (optional): the height of the embedded page in pixels
* `width` (optional): the width of the embedded page in pixels

## Markdown
You can embed markdown inside of markdown and live preview it. Is this useful? 🤷 Not particularly, it’s more of a demo of how this works. Nevertheless, to each their own, here’s an example:

```markdown
This is going to be **bold**
```