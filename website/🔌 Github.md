```meta
type: plug
uri: github:silverbulletmd/silverbullet-github/github.plug.json
repo: https://github.com/silverbulletmd/silverbullet-github
author: Zef Hemel
```

Provides Github events, notifications and pull requests as query sources using SB's query mechanism

* `gh-event` required filters in the `where` clause:
    * `username`: the user whose events to query
* `gh-pull`
    * `repo`: the repo to query PRs for
* `gh-notification` requires a `githubToken` to be configured in `SECRETS`.

## Example

Example uses:

    ## Recent pushes
    <!-- #query gh-event where username = "zefhemel" and type = "PushEvent" select type, actor_login, created_at, payload_ref limit 3 -->

    <!-- /query -->

    ## Recent PRs
    <!-- #query gh-pull where repo = "silverbulletmd/silverbullet" and user_login = "zefhemel" limit 3 render "template/gh-pull" -->

    <!-- /query -->

Where the `template/gh-pull` looks as follows:

    * ({{state}}) [{{title}}]({{html_url}})