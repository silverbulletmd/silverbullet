```meta
type: plug
uri: github:silverbulletmd/silverbullet-ghost/ghost.plug.json
repo: https://github.com/silverbulletmd/silverbullet-ghost
author: Zef Hemel
```
<!-- #include "https://raw.githubusercontent.com/silverbulletmd/silverbullet-ghost/main/README.md" -->
# Ghost plug for Silver Bullet

Note: Still very basic. To use:

In your `SETTINGS` specify the following settings:

        ```yaml
        ghostUrl: https://your-ghost-blog.ghost.io
        ghostPostPrefix: posts
        ghostPagePrefix: pages
        ```

And in your `SECRETS` file:

        ```yaml
        ghostAdminKey: your:adminkey
        ```

This will assume the naming pattern of `posts/my-post-slug` where the first top-level heading (`# Hello`) will be used as the post title.

Commands to use `Ghost: Publish`

## Installation
Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-ghost/ghost.plug.json
```

Then run the `Plugs: Update` command and off you go!
<!-- /include -->
