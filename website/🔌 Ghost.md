---
type: plug
uri: github:silverbulletmd/silverbullet-ghost/ghost.plug.js
repo: https://github.com/silverbulletmd/silverbullet-ghost
author: Zef Hemel
share-support: true
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-ghost/main/README.md]] -->
# Ghost plug for Silver Bullet

This allows you to publish your pages as [Ghost](https://ghost.org/) pages or
posts. I use it to publish [Zef+](https://zef.plus).

## Configuration

In your `SETTINGS` specify the following settings:

    ```yaml
    ghost:
      myblog:
        url: https://your-ghost-blog.ghost.io
    ```

Then, create a Custom Integration (in your Ghost control panel under Settings >
Advanced > Integrations > Add Custom Integration). Enter a name (whatever you
want), then copy the full Admin API Key in your `SECRETS` file, mirroring the
structure of SETTINGS:

    ```yaml
    ghost:
      myblog: your:adminkey
    ```

## Usage

The plugin hooks into Silver Bullet's
[Share infrastructure](https://silverbullet.md/%F0%9F%94%8C_Share). Therefore to
share a page as either a Ghost page or post, add a `$share` front matter key.
For posts this should take the shape of:

    ---
    $share:
    - ghost:myblog:post:my-post-slug
    ---

And for pages:

    ---
    $share:
    - ghost:myblog:page:my-page-slug
    ---

Now, when you {[Share: Publish]} (Cmd-s/Ctrl-s) your post will automatically be
created (as a draft) or updated if it already exists.

Enjoy!

## Installation

Open your `PLUGS` note in SilverBullet and add this plug to the list, or simply use the `Plugs: Add` command:

```
- github:silverbulletmd/silverbullet-ghost/ghost.plug.js
```

Then run the `Plugs: Update` command and off you go!
<!-- /include -->
