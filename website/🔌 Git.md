```meta
type: plug
uri: github:silverbulletmd/silverbullet-github/github.plug.json
repo: https://github.com/silverbulletmd/silverbullet-github
author: Zef Hemel
```

The git plug provides very basic “git sync” functionality, it assumes you have git configured for push and pull in your space. It offers two commands:

* `Git : Sync`:
  * Adds all *.md files in your folder to git
  * It commits them with a "Snapshot" commit message
  * It `git pull`s changes from the remote server
  * It `git push`es changes to the remote server

* `Git: Snapshot`:
  * Asks you for a commit message
  * Commits
