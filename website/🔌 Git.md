---
type: plug
uri: github:silverbulletmd/silverbullet-git/git.plug.js
repo: https://github.com/silverbulletmd/silverbullet-git
author: Zef Hemel
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-git/main/README.md]] -->
# SilverBullet plug for Git

Very basic in functionality, it assumes you have git configured for push and pull in your space. What it does, roughly speaking:

{[Git: Sync]}:

- Adds all files in your folder to git
- It commits them with a "Snapshot" commit message
- It `git pull`s changes from the remote server
- It `git push`es changes to the remote server

{[Git: Snapshot]}:

- Asks you for a commit message
- Commits

{[Github: Clone]}:

Clones into your space from a Github repository. This will do authentication based on a [personal access token](https://github.com/settings/tokens).

## Installation

Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-git/git.plug.js
```

Then run the `Plugs: Update` command and off you go!

## To Build

```shell
deno task build
```
<!-- /include -->
