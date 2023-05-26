---
type: plug
uri: github:silverbulletmd/silverbullet-twitter/twitter.plug.js
repo: https://github.com/silverbulletmd/silverbullet-twitter
author: SilverBullet Authors
---

<!-- #include [[https://raw.githubusercontent.com/silverbulletmd/silverbullet-twitter/main/README.md]] -->
# SilverBullet for Twitter
Currently the only thing this plug offers is unfurling links to tweets. To use, paste in a link to a Tweet like `https://twitter.com/zef/status/1547943418403295232`, then run the `Link: Unfurl` command and select `Tweet content` to "enrich" the tweet URL with the content of the linked tweet, e.g.

    https://twitter.com/zef/status/1547687321679511552

Turns into:

    [Zef Hemel](https://twitter.com/zef/status/1547687321679511552):
    > For those who missed my earlier posts on Silver Bullet: it’s my new powerful note taking/PKM app. Demo video from a user’s perspective: https://t.co/MKauSTcUG3 How it works technically (plugins all the way down): https://t.co/sqCkAa0pem Repo: https://t.co/rrxQdyxze1

## Installation

Open (`cmd+k`) your `PLUGS` note in SilverBullet and add this plug to the list:

```yaml
- github:silverbulletmd/silverbullet-twitter/twitter.plug.js
```

Then run the `Plugs: Update` command and off you go!
<!-- /include -->
