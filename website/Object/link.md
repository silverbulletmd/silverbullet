All page _links_ are tagged with `link`. You cannot attach additional tags to links. The main two attributes of a link are:

* `toPage` the page the link is linking _to_
* `page` the page the link appears on

In addition, the `snippet` attribute attempts to capture a little bit of context on where the link appears.

Here is a query that shows some links that appear in the [[Object]] page:

${query[[from index.tag "link" where page == "Object"]]}
