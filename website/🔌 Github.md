---
type: plug
uri: github:silverbulletmd/silverbullet-github/github.plug.json
repo: https://github.com/silverbulletmd/silverbullet-github
author: Zef Hemel
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-github/main/README.md]] -->
# SilverBullet plug for Github
Provides Github events, notifications and pull requests as query sources using SB's query mechanism

## Installation
Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-github/github.plug.json
```

Then run the `Plugs: Update` command and off you go!

## Configuration
This step is optional for anything but the `gh-notification` source, but without it you may be rate limited by the Github API,

To configure, add a `githubToken` key to your `SECRETS` page, this should be a [personal access token](https://github.com/settings/tokens):

        ```yaml
        githubToken: your-github-token
        ```

## Query sources

* `gh-event` List events of a user
    * `username`: the user whose events to query
* `gh-pull`: List pull requests in a repository
    * `repo`: the repo to query PRs for
* `gh-search-issue`: Search for issues and pull requests
    * `query`: [the search query](https://docs.github.com/en/rest/search#search-issues-and-pull-requests)
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
<!-- /include -->
