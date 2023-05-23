---
type: plug
uri: github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json
repo: https://github.com/silverbulletmd/silverbullet-mattermost
author: Zef Hemel
share-support: true
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-mattermost/main/README.md]] -->
# Mattermost for SilverBullet
This plug provides various integrations with the [Mattermost suite](https://www.mattermost.com) of products. Please follow the installation, configuration sections, and have a look at the example.

Features:

* Integration with [SilverBullet Share](https://silverbullet.md/%F0%9F%94%8C_Share), allowing you to publish and update a page as a post on Mattermost, as well as load existing posts into SB as a page using the {[Share: Mattermost Post: Publish]} (to publish an existing page as a Mattermost post) and {[Share: Mattermost Post: Load]} (to load an existing post into SB) commands.
* Access your saved posts via the `mm-saved` query provider
* Unfurl support for posts (after dumping a permalink URL to a post in a page, use the {[Link: Unfurl]} command).
* Boards support is WIP

## Installation
Run the {[Plugs: Add]} command and paste in the following URI: `github:silverbulletmd/silverbullet-mattermost/mattermost.plug.json` 

## Configuration
In `SETTINGS` provide the `mattermost` key with a `url` and `defaultTeam` for each server (you can name them arbitrarily):

    ```yaml
    mattermost:
      community:
        url: https://community.mattermost.com
        defaultTeam: core
      silverbullet:
        url: https://silverbullet.cloud.mattermost.com
        defaultTeam: main
    ```

In `SECRETS` provide a Mattermost personal access token (or hijack one from your current session) for each server:

    ```yaml
    mattermost:
      community: 1234
      silverbullet: 1234
    ```


## Query sources

* `mm-saved` fetches (by default 15) saved posts in Mattermost, you need to add a `where server = "community"` (with server name) clause to your query to select the mattermost server to query.

To make the `mm-saved` query results look good, it's recommended you render your query results with a template. Here is one to start with: you can keep it in e.g., `templates/mm-saved`:

    [{{username}}]({{url}}) in {{#if channelName}}**{{channelName}}**{{else}}a DM{{/if}} at _{{updatedAt}}_ {[Unsave]}:

    {{prefixLines (substring message 0 300 " ... (More)") "> "}}

    ---

Note that the `{[Unsave]}` button when clicked, will unsave the post automatically 😎

Example use of `mm-saved` (using the `template/mm-saved` template above):

    <!-- #query mm-saved where server = "community" order by updatedAt desc limit 5 render "template/mm-saved" -->

    <!-- /query -->

## Posting to a channel

You can use the {[Share: Mattermost Post: Publish]} command to publish the current page to a channel. You will be prompted to select the server and channel to post to. A `$share` key will be injected into frontmatter after the initial post. Subsequent post edits can be published via the standard {[Share: Publish]} command.

## Loading a post into SB

Using the {[Share: Mattermost Post: Load]} command you can load an existing post into your space. All you need for this is to have the Mattermost authentication configured as described above. You will be prompted for a post permalink and a page to save it to. If you are the author of the post, the `$share` frontmatter will also be set up so you can change the page and push changes back into Mattermost.
<!-- /include -->
