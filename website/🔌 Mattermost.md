```meta
type: plug
uri: github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json
repo: https://github.com/silverbulletmd/silverbullet-mattermost
author: Zef Hemel
```
<!-- #include "https://raw.githubusercontent.com/silverbulletmd/silverbullet-mattermost/main/README.md" -->
# Mattermost plug for Silver Bullet
Provides an `mm-saved` query provider (and maybe more in the future). Please follow the installation, configuration sections, and have a look at the example.

## Installation
Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json
```

Then run the `Plugs: Update` command and off you go!

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

    <!-- /query -->
<!-- /include -->
