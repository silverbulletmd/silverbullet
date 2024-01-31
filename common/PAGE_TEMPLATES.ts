export const SETTINGS_TEMPLATE =
  `This page contains settings for configuring SilverBullet and its plugs. Any changes outside of the yaml block will be overwritten.
A list of built-in settings [[!silverbullet.md/SETTINGS|can be found here]].

\`\`\`yaml
indexPage: index
\`\`\`
`;

export const INDEX_TEMPLATE =
  `This is the index page of your fresh SilverBullet space. It is the default page that is loaded when you open a space.

For your convenience we're including an on-boarding live template below. Enjoy!

\`\`\`include
raw: "[[!silverbullet.md/Getting Started]]"
\`\`\`
`;
