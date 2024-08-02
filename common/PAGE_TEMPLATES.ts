export const SETTINGS_TEMPLATE = `#meta

This page contains some configuration overrides for SilverBullet. A list of configs and their documentation [[!silverbullet.md/SETTINGS|can be found here]].

To update the [[!silverbullet.md/Libraries|libraries]] specified below, run {[Libraries: Update]}

\`\`\`space-config
indexPage: index
libraries:
- import: "[[!silverbullet.md/Library/Core/*]]"
\`\`\`
`;

export const INDEX_TEMPLATE =
  `This is the index page of your fresh SilverBullet space. It is the default page that is loaded when you open a space. In addition, there is also a [[^SETTINGS]] page that contains SilverBullet configuration.

For your convenience we're embedding some on-boarding info below. Feel free to delete it once you're done reading it.

![[!silverbullet.md/Getting Started]]
`;
