export const SETTINGS_TEMPLATE = `---
tags: meta
---
This page contains settings for configuring SilverBullet and its plugs. A list of built-in settings [[!silverbullet.md/SETTINGS|can be found here]].

\`\`\`yaml
indexPage: index
\`\`\`
`;

export const INDEX_TEMPLATE =
  `This is the index page of your fresh SilverBullet space. It is the default page that is loaded when you open a space. In addition, there is also a [[SETTINGS]] page that contains settings for configuring SilverBullet.

For your convenience we're including an on-boarding live template below. Enjoy!

\`\`\`include
raw: "[[!silverbullet.md/Getting Started]]"
\`\`\`
`;
