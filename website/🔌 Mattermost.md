```meta
type: plug
uri: github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json
repo: https://github.com/silverbulletmd/silverbullet-mattermost
author: Zef Hemel
```

Provides a `mm-saved` query provider (and maybe more in the future). Please follow the installation, configuration sections, and have a look at the example.

## Configuration
You need two bits of configuration to make this plug work. In `SETTINGS` provide the `mattermostUrl` and `mattermostDefaultTeam` settings, they default to the following:

    ```yaml
    mattermostUrl: https://community.mattermost.com
    mattermostDefaultTeam: core
    ```

In `SECRETS` provide a Mattermost personal access token (or hijack one from your current session):

    ```yaml
    mattermostToken: your-token
    ```

To make this look good, it's recommended you render your query results a template. Here is one to start with, you can keep it in e.g. `templates/mm-saved`:

    [{{username}}]({{desktopUrl}}) in **{{channelName}}** at {{updatedAt}} {[Unsave]}:

    {{prefixLines (substring message 0 300 " ... (More)") "> "}}

    ---

Note that the `{[Unsaved]}` "button" when clicked, will unsave the post automatically 😎

## Query sources

* `mm-saved` fetches (by default 15) saved posts in Mattermost

## Example

Example uses (using the `template/mm-saved` template above):

    <!-- #query mm-saved order by updatedAt desc limit 5 render "template/mm-saved" -->
[lindy.isherwood](mattermost://community.mattermost.com/private-core/pl/u8ospw14ptg47fystidzudigjw) in **R&D Meeting** at 2022-07-22 {[Unsave]}:

> #### [Meeting Recording](https://mattermost.zoom.us/rec/share/e0CmkZr_1xaW0Zd-7N-saD5fir9pmjJy6-xw4JZ7el7IMIUUUr99FiC2WePmBZDw.HRzSgvBjxhsPGQWo)
> 
> Access Passcode: `wq$!BA6N`

---
[harrison](mattermost://community.mattermost.com/core/pl/akuzqwdm4if7fdmajjb94hpm5c) in **** at 2022-07-20 {[Unsave]}:

> Hey Zef. Can we chat about the Affirm issue a bit when I get back? From what I've gathered, Devin's told customer support that the issue in Chromium isn't something we can reasonably fix, and while I don't feel like that's anything I should be worried about since it's out of my area, I keep getting  ... (More)

---
[zef.hemel](mattermost://community.mattermost.com/core/pl/k41cfgdbhfg5unm8yx1cjkh8ty) in **** at 2022-07-20 {[Unsave]}:

> I'll have to get back to this tomorrow. Filename says "arm64" though

---
[zef.hemel](mattermost://community.mattermost.com/core/pl/9e1ha9yzzpdm9ffhu4od65yykc) in **** at 2022-07-19 {[Unsave]}:

> Agreed. Thinking what are better indicators than what we already ask. I’ll reach out. 

---
[zef.hemel](mattermost://community.mattermost.com/private-core/pl/hh79ikgfzb8zmb4ezjuow7a1mw) in **Team: Web Platform** at 2022-07-15 {[Unsave]}:

> @webplatform in yesterday’s 1:1 with @harrison we came up with the concept of “theme weeks” to solve our problem of scheduling _important but not urgent_ work. Examples are: looking at performance improvements, cleaning/fixing lingering bugs from our backlog, working on accessibility tickets, perfor ... (More)

---
<!-- /query -->