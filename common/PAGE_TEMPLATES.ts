export const SETTINGS_TEMPLATE = `#meta

This page contains some configuration overrides for SilverBullet. A list of configs and their documentation [[!v1.silverbullet.md/SETTINGS|can be found here]].

To update the [[!v1.silverbullet.md/Libraries|libraries]] specified below, run {[Libraries: Update]}

\`\`\`yaml
indexPage: "[[index]]"
libraries:
- import: "[[!v1.silverbullet.md/Library/Core/*]]"
\`\`\`
`;

export const INDEX_TEMPLATE =
  `This is the index page of your fresh SilverBullet space. It is the default page that is loaded when you open a space. In addition, there is also a [[^SETTINGS]] page that contains SilverBullet configuration.

For your convenience we're embedding some on-boarding info below. Feel free to delete it once you're done reading it.

![[!v1.silverbullet.md/Getting Started]]
`;
