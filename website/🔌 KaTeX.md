---
type: plug
uri: github:silverbulletmd/silverbullet-katex/katex.plug.js
repo: https://github.com/silverbulletmd/silverbullet-katex
author: Zef Hemel
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-katex/main/README.md]] -->
# Silver Bullet KaTeX plug

## Installation
Run the {[Plugs: Add]} command and paste in: `github:silverbulletmd/silverbullet-katex/katex.plug.js`

That's all!

## Use

Put a latex block in your markdown:

    ```latex
    c = \pm\sqrt{a^2 + b^2}
    ```

And move your cursor outside of the block to live preview it!

**Note:** [KaTeX](https://katex.org) itself is not bundled with this plug, it pulls the JavaScript, CSS and fonts from the JSDelivr CDN. This means _this plug will not work without an Internet connection_. The reason for this limitation is that it is not yet possible to distribute font files via plugs, and KaTeX depends on specific web fonts.

## Build
Assuming you have Deno and Silver Bullet installed, simply build using:

```shell
deno task build
```

Or to watch for changes and rebuild automatically

```shell
deno task watch
```

Then, load the locally built plug, add it to your `PLUGS` note with an absolute path, for instance:

```
- file:/Users/you/path/to/katex.plug.json
```

And run the `Plugs: Update` command in SilverBullet.
<!-- /include -->
