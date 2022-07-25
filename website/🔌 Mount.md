```meta
type: plug
uri: github:silverbulletmd/silverbullet-mount/mount.plug.json
repo: https://github.com/silverbulletmd/silverbullet-mount
author: Zef Hemel
```
<!-- #include "https://raw.githubusercontent.com/silverbulletmd/silverbullet-mount/main/README.md" -->
# Mounting of external systems into SB
Enables mounting of external folders or SB instances into your space.

## Installation
Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-mount/mount.plug.json
```

Then run the `Plugs: Update` command and off you go!

## Configuration
Create a `MOUNTS` page:

        ```yaml
        # Mounting another local folder with a docs/ prefix
        - prefix: docs/
          path: file:/Users/me/docs
        # Mounting an external SB instance to remote/
        - prefix: remote/
          path: http://some-ip:3000
          password: mypassword
        ```
<!-- /include -->
