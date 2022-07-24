```meta
type: plug
uri: github:silverbulletmd/silverbullet-ghost/ghost.plug.json
repo: https://github.com/silverbulletmd/silverbullet-ghost
author: Zef Hemel
```

Very basic plug to publish pages and posts onto the [Ghost](https://ghost.org) platform

## Configuration

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