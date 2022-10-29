---
type: plug
uri: github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json
repo: https://github.com/silverbulletmd/silverbullet-mattermost
author: Zef Hemel
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-mattermost/main/README.md]] -->
# Mattermost plug for Silver Bullet
This plug provides a few query providers to query data from some of the [Mattermost suite](https://www.mattermost.com) of products. Please follow the installation, configuration sections, and have a look at the example.

## Installation
Open your `PLUGS` note in SilverBullet and add this plug to the list:

```
- github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json
```

Then run the `Plugs: Update` command and off you go!

## Configuration
When using the `mm-saved` query provide, you need two bits of configuration to make this plug work. In `SETTINGS` provide the `mattermostUrl` and `mattermostDefaultTeam` settings, they default to the following:

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

If you use the `mm-boards` query provider, you do not need any configuration of secrets.

## Query sources

* `mm-saved` fetches (by default 15) saved posts in Mattermost
* `mm-board` fetches all cards from a Mattermost board exposed via a public share URL (obtained via Share > Publish > Publish to Web > Copy Link) via an `url =` filter (see example below)

## Commands

* `Convert post to note` fetches a post by passing its permalink and adds it to a note. If the note doesn't exist, it creates a new one.
* `Unfurl: permalink` available while positioning the caret on top of a mattermost permalink related to the configured url, will fetch the post contents.

## Example

Example use of `mm-saved` (using the `template/mm-saved` template above):

    <!-- #query mm-saved order by updatedAt desc limit 5 render "template/mm-saved" -->

    <!-- /query -->

Example use of `mm-board`:

    <!-- #query mm-board where url = "https://community.mattermost.com/plugins/focalboard/workspace/p33mj7xh4frntrtbxbp5xp1joy/shared/bbam1crdg6jn93qhcgiq8xbpk8a/vqnxrjaewnibrtnp8m38fswt63e?r=keadbck8m8oc84ng6ozhcqqcgpc" and team = "Server Platform" and quarter = "2022 Q3" select objective, title, status -->
    
    <!-- /query -->
<!-- /include -->
