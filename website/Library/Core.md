This library is highly recommended for everybody to install immediately. It provides a lot of functionality you’ll likely appreciate.

Some random examples:
* [[Table of Contents]] and [[Linked Mentions]]
* All the slash commands you know and love, ranging from `/h1` to `/task` to `/table` to `/code` to `/query` to `/template` to `/today` to...
* Some useful general purpose pages such as [[Library/Core/Page/Maintenance]] and [[Library/Core/Page/Templates]].

# Installation
To import this library, run the {[Import Library]} command in your SilverBullet space and enter:

    !silverbullet.md/Library/Core/

# Included templates
```query
page
where name =~ /^{{escapeRegexp @page.name}}\//
render [[Library/Core/Query/Template]]
```


