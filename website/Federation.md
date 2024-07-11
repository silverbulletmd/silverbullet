Federation enables _browsing_ content from spaces _outside_ the user’s space, specified by quasi-URLs in the shape of `!domain.tld/path`. An example would be: [[!silverbullet.md/CHANGELOG]].

This enables a few things:

* **Browsing** other publicly hosted SilverBullet spaces (or websites adhering to its [[API]]) within the comfort of your own SilverBullet client. One use case of this is [[Transclusions|transcluding]] the [[Getting Started]] page in the user’s automatically generated index page when setting up a fresh space.
* **Referencing** other spaces for other purposes, which is leveraged in [[Libraries]].

# How it works
Effectively, any page [[Links|link]] starting with `!` is rewritten as follows:

* Replace the initial `!` with `https://`
* Append `.md` at the end

The resulting URL is then fetched and displayed in the editor in read-only mode. This means that you can navigate to _any markdown_ file on the (public) Internet.

For example: `https://raw.githubusercontent.com/silverbulletmd/silverbullet/main/README.md`
Can be written to federation syntax as follows: `!raw.githubusercontent.com/silverbulletmd/silverbullet/main/README`
And used as a link: [[!raw.githubusercontent.com/silverbulletmd/silverbullet/main/README]]

If the target server supports the SilverBullet [[API]] (specifically its `/index.json` endpoint), page completion will be provided as well.

Upon fetching of the page content, a best effort attempt will be made to rewrite any local page links in the page to the appropriate federated paths.

## Hosting
Tooling to make hosting public spaces easier is still a work in progress. The way it is enabled on `silverbullet.md` is by running a dedicated SilverBullet instance in read-only mode (see [[Install/Configuration#Run mode]]).