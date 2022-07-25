```meta
type: plug
uri: github:silverbulletmd/silverbullet-mount/mount.plug.json
repo: https://github.com/silverbulletmd/silverbullet-mount
author: Zef Hemel
```

Enables mounting of external folders or SB instances into your space mounted under a `🚪` prefix.

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

This will make these available under `🚪 docs/` and `🚪 remote/` respectively.

## Features
* Auto translates internal wiki links (prefixes with prefix) and removes prefix upon save

## To do
* [ ] Handle queries
  * `page` and `link` query needs to dynamically add/remove a `and name =~ /^🚪 PREFIX/` clause)
  * `task` same but with `page` check
* [x] Add `file:` support
* [x] Add `http:`/`https:` support
