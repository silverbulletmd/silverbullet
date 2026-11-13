---
description: The original light look of SilverBullet.
tags: meta/theme
displayName: SilverBullet Classic
scheme: light
fonts:
  editor: ia-writer-mono
counterpart: "[[Library/silverbulletmd/Themes/Classic/Dark]]"
---
The light half of [[Library/silverbulletmd/Themes/Classic]].

```space-style
html {
  --root-background-color: #fff;
  --root-color: #20252d;
  --subtle-color: #676767;
  --subtle-background-color: rgba(72, 72, 72, 0.1);
  --ui-surface-border-color: #d8dce1;
  --ui-accent-color: #3569b8;
  --ui-accent-contrast-color: #fff;
  --link-color: #0330cb;
  --link-missing-color: #9e4705;
  --meta-color: #650007;
  --meta-subtle-color: color-mix(
    in srgb,
    var(--subtle-color),
    var(--root-background-color) 30%
  );
  --highlight-color: rgba(255, 255, 0, 0.5);
  --ui-accent-text-color: var(--ui-accent-color);
  --top-background-color: color-mix(
    in srgb,
    var(--root-background-color),
    var(--subtle-color) 11%
  );
  --top-border-color: color-mix(
    in srgb,
    var(--root-background-color),
    var(--subtle-color) 35%
  );
  --top-page-folder-color: currentColor;
  --top-page-folder-font-weight: inherit;
  --progress-background-color: var(--top-border-color);
  --panel-background-color: color-mix(
    in srgb,
    var(--root-background-color),
    var(--root-color) 3.5%
  );
  --modal-backdrop-color: transparent;
  --modal-shadow-color: rgba(0, 0, 0, 0.35);
  --modal-help-background-color: color-mix(
    in srgb,
    var(--modal-background-color),
    var(--meta-subtle-color) 16%
  );
  --modal-selected-option-background-color: color-mix(
    in srgb,
    var(--ui-accent-color) 12%,
    var(--modal-background-color)
  );
  --modal-selected-option-color: var(--root-color);
  --modal-selected-option-description-color: var(--subtle-color);
  --editor-caret-color: var(--root-color);
  --editor-panels-bottom-border-color: var(--top-border-color);
  --editor-completion-selected-background-color: var(--ui-accent-strong-color);
  --editor-completion-selected-color: var(--ui-accent-strong-contrast-color);
  --editor-list-bullet-color: var(--meta-subtle-color);
  --editor-heading-color: color-mix(
    in srgb,
    var(--root-color),
    var(--subtle-color) 20%
  );
  --editor-heading-meta-color: var(--meta-subtle-color);
  --editor-hashtag-background-color: var(--ui-accent-strong-color);
  --editor-hashtag-color: var(--ui-accent-strong-contrast-color);
  --editor-hashtag-border-color: color-mix(
    in srgb,
    var(--ui-accent-strong-color),
    black 25%
  );
  --editor-hashtag-border-radius: 6px;
  --editor-ruler-color: color-mix(in srgb, var(--meta-subtle-color), black 50%);
  --editor-wiki-link-page-background-color: color-mix(
    in srgb,
    var(--link-color) 5%,
    transparent
  );
  --editor-link-text-decoration: none;
  --editor-table-head-background-color: color-mix(
    in srgb,
    var(--subtle-color),
    black 50%
  );
  --editor-table-head-color: color-mix(in srgb, white 90%, var(--root-color));
  --editor-table-even-background-color: color-mix(
    in srgb,
    var(--root-background-color),
    var(--subtle-color) 8%
  );
  --editor-blockquote-background-color: var(--subtle-background-color);
  --editor-blockquote-border-color: color-mix(
    in srgb,
    var(--subtle-color),
    black 28%
  );
  --editor-code-background-color: var(--subtle-background-color);
  --editor-frontmatter-background-color: color-mix(
    in srgb,
    var(--highlight-color) 16%,
    transparent
  );
  --editor-widget-background-color: color-mix(
    in srgb,
    var(--root-background-color),
    var(--meta-subtle-color) 16%
  );
  --editor-task-marker-color: var(--subtle-color);
}
```
