#maturity/beta

SilverBullet is aimed for single-user, private use. Nevertheless, many have the need to _share_ some content kept in SilverBullet with the outside world: to push content out, pull it in, or even sync between different locations. This is where SilverBullet _share_ functionality comes in. 

**Note:** If you are interested in one-off ways to get content out, have a look at [[Export]].

# Modes
Sharing may be desirable in different directions:
* _Push_: produce content in SilverBullet, then push it to some external location, while being able to keep the external place up to date with changes, keeping SilverBullet as the source of truth. Example use cases:
  * Blog posts
  * Social network posts
  * [[Library]] you want to distribute to others
* _Pull_: pull in content from an external location and import it into your space and be able to keep pulling in new versions on demand. Use cases:
  * [[Library]] that you install, e.g. via the [[Library Manager]]
* _Sync_: For bi-directional push and pull. Example use cases:
  * Collaborate on a page with other SilverBullet users (not implemented yet)

# Operation
SilverBullet has [[^Library/Std/Infrastructure/Share|infrastructural support]] to solve this problem in a general way. It leverages [[Frontmatter]], specifically the following three keys:

* `share.uri`: specifies the external location to push, pull or sync your content with, represented as a [[URI|URI]].
* `share.mode`: specifies the _mode_ this sharing should happen, options are: `push`, `pull` or `sync`
* `share.hash`: automatically calculated and updated content hash of your local version to detect whether local changes were made since the last share operation.

# Workflow
On the page you’re interested to share, run the ${widgets.commandButton "Share: Page"} (bound to `Cmd-p`/`Ctrl-p` by default) command. This will pop up a list of enabled “Share providers”. Pick one and follow the provider-specific setup steps. At the end, your page will be shared and the `share.*` frontmatter keys automatically set.

Subsequent shares can be done simply by running the `Share: Page` command again.

# Support
Out of the box, sharing is supported for:

* Plain `https://` URIs (_Pull_ mode only) (implemented in [[^Library/Std/Infrastructure/URI]]).
* [[^Library/Std/Infrastructure/Github]] (`https://github.com/*` for repository files and `https://gist.github.com/*` URLs): both in _Pull_ mode, and _Push_ mode when a token is configured. Technically _Sync_ should work except that Github aggressively caches files, making this impractical.

To implement your own share provider, have a look at the implementations linked to understand how they work.
