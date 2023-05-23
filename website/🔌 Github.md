---
type: plug
uri: github:silverbulletmd/silverbullet-github/github.plug.js
repo: https://github.com/silverbulletmd/silverbullet-github
author: Zef Hemel
share-support: true
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-github/main/README.md]] -->
# SilverBullet plug for Github
Provides various integrations with Github:

* Query sources for events, notifications and pull requests
* Ability to load and share pages as Gists

## Installation
Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-github/github.plug.json
```

Then run the `Plugs: Update` command and off you go!

## Configuration
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

## Share as Gist support

To use: navigate to a page, and run the {[Share: Gist: Public Gist]} command, this will perform an initial publish, and add a `$share` attribute to your page's front matter. Subsequent updates can be performed via {[Share: Publish]}.

To pull an *existing* gist into your space, use the {[Share: Gist: Load]} command and paste the URL to the gist.
## Example

Example uses of the query providers:

    ## Recent pushes
    <!-- #query gh-event where username = "zefhemel" and type = "PushEvent" select type, actor_login, created_at, payload_ref limit 3 -->

    <!-- /query -->

    ## Recent PRs
    <!-- #query gh-pull where repo = "silverbulletmd/silverbullet" and user_login = "zefhemel" limit 3 render "template/gh-pull" -->

    <!-- /query -->

Where the `template/gh-pull` looks as follows:

    * ({{state}}) [{{title}}]({{html_url}})
<!-- /include -->
