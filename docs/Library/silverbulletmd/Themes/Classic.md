---
name: Library/silverbulletmd/Themes/Classic
tags: meta/library
description: SilverBullet Classic and Classic Dark, the original look of SilverBullet.
files:
- Classic/Light.md
- Classic/Dark.md
share.uri: "github:silverbulletmd/silverbullet-libraries@main/Library/silverbulletmd/Themes/Classic.md"
share.mode: pull
share.hash: 6d690726
---
**SilverBullet Classic** brings back SilverBullet's original look: iA Writer Mono for your pages, a gray top bar, blue links on a light tint, filled hashtag pills and a dark table header. [[Library/silverbulletmd/Themes/Classic/Light|SilverBullet Classic]] is the light theme and [[Library/silverbulletmd/Themes/Classic/Dark|SilverBullet Classic Dark]] the dark one.

Pick either in Configuration → Appearance → Theme, or with ${widgets.commandButton("Theme: Select")}. ${widgets.commandButton("Theme: Toggle Light/Dark")} switches between the two.

The layout is the original one too: while a Classic theme is active, the styles below put back the original element styling (square controls, filled hashtags, plain tables, the sidebar's accent bar and so on) in place of SilverBullet's newer look. Both themes suggest iA Writer Mono for your pages, which comes with SilverBullet; the suggestion only applies while you haven't picked an editor font yourself. The interface uses Inter, as it does everywhere in SilverBullet.

```space-style
:where(html[data-sb-theme^="Library/silverbulletmd/Themes/Classic/"]) {
  --modal-help-color: color-mix(
    in srgb,
    var(--root-color),
    var(--meta-subtle-color) 42%
  );
  --modal-hint-background-color: var(--ui-accent-strong-color);
  --modal-hint-color: var(--ui-accent-strong-contrast-color);
  --notification-info-background-color: color-mix(
    in srgb,
    var(--alert-info-color) 10%,
    var(--modal-background-color)
  );
  --notification-error-background-color: color-mix(
    in srgb,
    var(--alert-error-color) 10%,
    var(--modal-background-color)
  );
  --notification-warning-background-color: color-mix(
    in srgb,
    var(--alert-warning-color) 10%,
    var(--modal-background-color)
  );

  /* Controls */
  .sb-button, .sb-button-primary, .sb-button-danger {
    border-radius: 2px;
    padding: 0.35em 0.75em;
    font-size: 13px;
    font-weight: revert;
  }
  .sb-button:not(.sb-button-primary):not(.sb-button-danger) {
    --sb-button-background-color: var(--button-background-color);
    --sb-button-hover-background-color: var(--button-hover-background-color);
    --sb-button-border-color: var(--button-border-color);
  }
  :is(.sb-button, .sb-button-primary, .sb-button-danger) .sb-kbd {
    margin-left: 0.5em;
    font-size: 0.85em;
  }
  :is(
    .sb-button, .sb-button-primary, .sb-button-icon, .sb-tab, .sb-checkbox
  ):focus-visible {
    outline: 2px solid var(--ui-accent-color);
    outline-offset: 2px;
  }
  :is(.sb-button-danger, .sb-segment):focus-visible {
    outline: revert;
    outline-offset: revert;
  }
  .sb-button-icon {
    border-radius: 2px;
  }
  .sb-button-icon:hover {
    background-color: var(--subtle-background-color);
    color: var(--button-color);
  }
  .sb-input, .sb-select {
    border-color: var(--button-border-color);
    border-radius: 2px;
  }
  :is(.sb-input, .sb-select):focus-visible {
    border-color: var(--text-field-focus-color);
    box-shadow: none;
  }
  .sb-url-input {
    border: 0;
    border-radius: 2px;
  }
  .sb-url-input:focus-within {
    outline: 1px solid var(--text-field-focus-color);
    outline-offset: -1px;
    box-shadow: none;
  }
  .sb-url-affix {
    background: var(--subtle-background-color);
  }
  .sb-tab {
    font-weight: revert;
  }
  .sb-tab.sb-active {
    color: var(--ui-accent-color);
    font-weight: 700;
  }
  .sb-segments, .sb-nav-root .sb-segments {
    border-radius: 6px;
    background-color: color-mix(
      in srgb,
      var(--ui-surface-section-background-color) 60%,
      transparent
    );
  }
  .sb-segment {
    border-radius: 2px;
  }
  .sb-segment.sb-segment-active {
    background-color: var(--modal-selected-option-background-color);
    color: var(--modal-selected-option-color);
    box-shadow: none;
  }
  .sb-section-link {
    border-radius: 2px;
  }
  .sb-section-link[aria-current="page"] {
    background: transparent;
    color: inherit;
  }
  .sb-section-link.sb-section-link:hover {
    background: var(--subtle-background-color);
  }
  .sb-section-link.sb-section-link:focus-visible {
    background: color-mix(
      in srgb,
      var(--ui-accent-color) 12%,
      var(--root-background-color)
    );
    outline: 1px solid var(--ui-accent-color);
    outline-offset: 2px;
  }
  .sb-section-link[aria-current="page"]::before {
    content: "";
    position: absolute;
    inset: 9px auto 9px 0;
    width: 3px;
    background: var(--ui-accent-color);
  }
  @media (max-width: 640px) {
    .sb-section-nav:not(.sb-section-nav-responsive) .sb-section-links {
      gap: 0.25rem;
      border-bottom: 1px solid var(--ui-surface-border-color);
    }
    .sb-section-nav:not(.sb-section-nav-responsive)
      .sb-section-link[aria-current="page"]::before {
      inset: auto 0 0;
      width: auto;
      height: 2px;
    }
  }
  .sb-badge {
    padding: 2px 6px;
    font-size: 10px;
    border-radius: 2px;
  }
  .sb-alert,
  .sb-progress,
  .sb-search-model-card,
  .sb-row-menu,
  .sb-row-menu > button {
    border-radius: 2px;
  }
  .sb-row-menu {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }
  .sb-nav-primary mark, .sb-nav-description mark {
    background-color: var(--editor-highlight-background-color);
    color: inherit;
    font-weight: inherit;
  }

  /* Top bar, modals and notifications */
  #sb-top .main #sb-current-page :is(.sb-input, .sb-page-name-display) {
    letter-spacing: inherit;
  }
  @media (max-width: 600px) {
    #sb-top .main #sb-current-page .sb-page-name-folder {
      display: revert;
    }
    .sb-modal-box {
      border-radius: 0;
    }
  }
  .sb-modal-box {
    border-radius: 4px;
    box-shadow: var(--modal-shadow-color) 0px 20px 20px;
  }
  .sb-modal-box .sb-prompt {
    padding: 13px 10px 10px 10px;
  }
  .sb-modal-box .sb-prompt label {
    font-weight: bold;
    font-size: inherit;
    line-height: inherit;
  }
  .sb-modal-box .sb-prompt .sb-input {
    padding: 0.4em 0.8em;
  }
  .sb-modal-box .sb-prompt .sb-prompt-buttons {
    margin-top: 10px;
    gap: 10px;
  }
  .sb-notifications {
    font-family: var(--editor-font);
    font-size: 15px;
  }
  .sb-notifications > div {
    padding: 3px 8px;
    margin-bottom: 3px;
    border-radius: 0;
    box-shadow: none;
    color: inherit;
  }
  .sb-notifications > div::before {
    content: none;
  }
  #sb-main > :is(.sb-panel, .sb-nav-root-lhs, .sb-nav-root-rhs) {
    border-top: 0;
  }

  /* Sidebars and pickers */
  .sb-nav-root {
    --sb-nav-row-height: 36px;
  }
  .sb-nav-header {
    border-bottom-color: var(--ui-surface-border-color);
  }
  .sb-nav-create {
    border-top-color: var(--ui-surface-border-color);
  }
  .sb-nav-title {
    font-weight: inherit;
  }
  .sb-nav-input:focus-visible {
    box-shadow: inset 0 -1px var(--text-field-focus-color);
  }
  .sb-nav-body {
    padding: 0;
  }
  .sb-nav-row {
    border-radius: 0;
    font-size: inherit;
  }
  .sb-nav-row[aria-current="page"]::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--ui-accent-color);
    pointer-events: none;
  }
  .sb-nav-row.sb-nav-folder {
    --sb-nav-band: color-mix(
      in srgb,
      var(--ui-surface-section-background-color) 60%,
      transparent
    );
    font-weight: 600;
  }
  .sb-page-widget-body .sb-nav-folder {
    font-weight: inherit;
  }
  .sb-nav-folder-part {
    color: inherit;
    font-weight: inherit;
  }
  .sb-nav-row.sb-nav-selected .sb-row-actions {
    border-radius: 0;
  }
  .sb-nav-chip:not(.sb-hashtag) {
    display: revert;
    align-items: normal;
    align-self: auto;
    padding: 2px 6px;
    border-radius: 2px;
    font-size: 10px;
    line-height: 1;
    font-weight: revert;
  }
  .sb-nav-chip.sb-nav-chip-hint {
    padding: 3px 5px;
    border-radius: 5px;
    font-size: inherit;
  }
  .sb-nav-selected .sb-nav-chip.sb-nav-chip-hint {
    background-color: color-mix(
      in srgb,
      var(--modal-selected-option-color) 22%,
      transparent
    );
    color: var(--modal-selected-option-color);
  }
  .sb-nav-chip.sb-hashtag {
    padding: 0 3px;
  }
  :is(.sb-nav-root-lhs, .sb-nav-root-rhs) {
    .sb-nav-header {
      display: flex;
      align-items: normal;
      gap: 8px;
      padding: 13px 10px 10px 10px;
      font-size: inherit;
    }
    .sb-nav-header-row {
      display: flex;
    }
    .sb-nav-title, .sb-nav-header:has(.sb-nav-segment-row) .sb-nav-title {
      font-size: inherit;
      font-weight: inherit;
      display: revert;
    }
    .sb-nav-input {
      padding: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    .sb-nav-input:focus-visible {
      box-shadow: inset 0 -1px var(--text-field-focus-color);
    }
    .sb-nav-row .sb-row-actions {
      position: absolute;
      margin: 0;
      align-self: auto;
      padding: 0 4px 0 22px;
      border-radius: 0;
      background-color: var(--modal-background-color);
      background-image: linear-gradient(
        var(--sb-nav-band, transparent),
        var(--sb-nav-band, transparent)
      );
      -webkit-mask-image: linear-gradient(to right, transparent, #000 20px);
      mask-image: linear-gradient(to right, transparent, #000 20px);
    }
    .sb-nav-row.sb-nav-selected .sb-row-actions {
      background-image: linear-gradient(
        var(--modal-selected-option-background-color),
        var(--modal-selected-option-background-color)
      );
    }
  }
  .sb-modal:has(> .sb-nav-root-modal) {
    border-radius: 4px;
    border-color: var(--modal-border-color);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
  }
  .sb-nav-root.sb-nav-root-modal {
    .sb-nav-header {
      padding: 13px 10px 10px 10px;
    }
    .sb-nav-header-row {
      font-size: inherit;
      padding: 0;
      gap: 6px;
      align-items: baseline;
    }
    .sb-nav-header-row::before {
      content: none;
    }
    .sb-nav-title {
      font-size: inherit;
    }
    .sb-nav-input {
      font-size: 1em;
      font-weight: inherit;
      color: inherit;
    }
    .sb-nav-input::placeholder {
      color: revert;
      opacity: revert;
    }
    .sb-nav-segment-row {
      padding: 0;
    }
    .sb-nav-segment-row:not(.sb-nav-segment-row-actions) {
      gap: normal;
    }
    .sb-segments {
      flex-wrap: wrap;
      font-size: inherit;
      background-color: color-mix(
        in srgb,
        var(--ui-surface-section-background-color) 60%,
        transparent
      );
    }
    .sb-segment {
      padding: 3px 8px;
      font-weight: inherit;
    }
    .sb-segment.sb-segment-active {
      color: var(--modal-selected-option-color);
    }
    .sb-nav-segment-row-actions {
      flex-wrap: nowrap;
      row-gap: 8px;
    }
    .sb-nav-segment-row-actions .sb-segments-wrap {
      flex: 1 1 auto;
    }
    .sb-nav-segment-row-actions .sb-nav-dropdown {
      margin-left: 0;
    }
    .sb-nav-dropdown {
      background-color: color-mix(
        in srgb,
        var(--ui-surface-section-background-color) 60%,
        transparent
      );
      font-size: 12px;
      padding: 0 20px 0 8px;
      width: revert;
    }
    .sb-nav-dropdown:focus-visible {
      box-shadow: inset 0 0 0 1px var(--text-field-focus-color);
    }
    .sb-nav-dropdown:hover {
      color: var(--subtle-color);
      background-color: color-mix(
        in srgb,
        var(--ui-surface-section-background-color) 60%,
        transparent
      );
      border-radius: 6px;
    }
    .sb-nav-help {
      font-size: 0.8em;
      padding: 6px 10px;
    }
    .sb-nav-body {
      padding: 0;
    }
    .sb-nav-row {
      padding: 8px;
      font-size: inherit;
      min-height: auto;
    }
    .sb-nav-row:has(> .sb-nav-text) {
      min-height: var(--sb-nav-row-height);
    }
    .sb-nav-text {
      gap: 0.15em;
    }
    .sb-nav-primary {
      font-weight: inherit;
      color: inherit;
    }
    .sb-nav-aspiring .sb-nav-primary {
      color: var(--sb-nav-muted);
    }
    .sb-nav-description {
      font-size: 75%;
      line-height: inherit;
      color: var(--modal-description-color);
    }
    .sb-nav-description-text {
      white-space: inherit;
    }
    .sb-nav-icon {
      color: var(--sb-nav-muted);
    }
    .sb-nav-row.sb-nav-selected {
      background: var(--modal-selected-option-background-color);
      color: var(--modal-selected-option-color);
    }
    .sb-nav-row.sb-nav-selected .sb-nav-primary {
      color: inherit;
    }
    .sb-nav-row.sb-nav-selected .sb-nav-description {
      color: var(--modal-selected-option-description-color);
    }
    .sb-nav-row.sb-nav-selected .sb-nav-icon {
      color: var(--sb-nav-muted);
    }
    :is(.sb-nav-primary, .sb-nav-description) mark {
      color: inherit;
      font-weight: inherit;
      background: var(--editor-highlight-background-color);
      border-radius: 0;
      padding: 0;
    }
  }

  /* The editor */
  #sb-main .cm-editor {
    .sb-line-h1 {
      font-size: 1.5em;
      letter-spacing: inherit;
    }
    .sb-line-h2 {
      font-size: 1.2em;
      letter-spacing: inherit;
    }
    .sb-line-h3 {
      font-size: 1.1em;
    }
    .sb-wiki-link {
      padding: 0 5px;
      margin: 0 -5px;
      font-weight: inherit;
      text-underline-offset: inherit;
    }
    a.wiki-link {
      text-underline-offset: inherit;
    }
    :is(
      a.sb-link,
      .sb-lua-directive-block a,
      .sb-lua-directive-inline a,
      .sb-markdown-widget a,
      .sb-page-widget a
    )[href*="://"] {
      text-decoration: revert;
      text-underline-offset: revert;
    }
    .sb-naked-url {
      text-decoration: var(--editor-link-text-decoration);
      text-underline-offset: inherit;
    }
    a.sb-link[href*="://"] .sb-link {
      text-decoration: underline;
    }
    :is(
      .sb-naked-url,
      :is(
        a.sb-link,
        .sb-lua-directive-block a,
        .sb-lua-directive-inline a,
        .sb-markdown-widget a,
        .sb-page-widget a
      )[href*="://"]
    )::after {
      content: none;
    }
    .sb-ordered-mark-slot .sb-meta {
      color: var(--editor-meta-color);
    }
    .sb-ordered-mark-slot :is(.sb-li-cursor .sb-meta) {
      color: var(--editor-line-meta-color);
    }
    .sb-task-slot .sb-atom {
      color: var(--editor-code-atom-color);
    }
    .sb-task > .sb-task-mark {
      color: var(--editor-task-marker-color);
    }
    .sb-task-slot [data-task-state] .sb-task-state, .sb-task > .sb-task-state {
      font-family: inherit;
      font-size: inherit;
      font-weight: inherit;
      letter-spacing: inherit;
      color: var(--editor-task-state-color);
    }
    .sb-task-dropdown {
      font-family: inherit;
      font-size: inherit;
      color: inherit;
    }
    input[type="checkbox"] {
      display: inline-block;
      place-content: normal;
      width: 1.3em;
      height: 1.3em;
      border: 1.5px solid currentColor;
      border-radius: 3px;
      background: transparent;
      vertical-align: middle;
    }
    input[type="checkbox"]:checked {
      background: transparent;
      border-color: currentColor;
    }
    input[type="checkbox"]:checked::after {
      width: 32%;
      height: 64%;
      border: solid currentColor;
      border-width: 0 1.5px 1.5px 0;
      transform: rotate(45deg);
    }
    :is(.sb-checkbox, .sb-task) input[type="checkbox"] {
      border-radius: 3px;
      vertical-align: middle;
      margin: 0;
    }
    .sb-hashtag[data-tag-name] {
      font-size: 0.9em;
      font-weight: inherit;
      padding: 0 3px;
      margin: 0 1px 0 0;
    }
    .sb-attribute {
      font-size: inherit;
      color: inherit;
      background: none;
      box-shadow: none;
      border-radius: 0;
      padding: 0;
      margin: 0;
      white-space: inherit;
    }
    .sb-attribute > * {
      font-family: inherit;
    }
    .sb-attribute .sb-attribute-value {
      color: inherit;
    }
    .sb-attribute .sb-meta {
      display: revert;
      color: var(--editor-meta-color);
    }
    .sb-attribute > .sb-frontmatter {
      font-family: var(--editor-monospace-font, monospace);
      color: var(--editor-frontmatter-color);
    }
    .sb-attribute > .sb-attribute-name {
      color: var(--editor-code-atom-color);
    }
    .sb-attribute > :is(.sb-li-cursor .sb-meta) {
      color: var(--editor-line-meta-color);
    }
    .sb-attribute .sb-attribute-name::after {
      content: none;
    }
    .cm-line:not(.sb-line-fenced-code) .sb-code, .sb-highlight {
      border-radius: 0;
      padding: 0;
    }
    .cm-line:not(.sb-line-fenced-code) + .sb-line-fenced-code,
    .sb-line-fenced-code:has(+ .cm-line:not(.sb-line-fenced-code)) {
      border-radius: 0;
    }
    .sb-admonition {
      background-color: var(--editor-blockquote-background-color);
      color: var(--editor-blockquote-color);
      padding-right: 0;
    }
    .sb-admonition-title {
      background-color: color-mix(
        in srgb,
        var(--admonition-color),
        transparent 90%
      );
      border-top-right-radius: 0;
      padding-top: 0;
      font-weight: inherit;
    }
    .sb-admonition:not(:has(+ .sb-admonition:not(.sb-admonition-title))) {
      border-bottom-right-radius: 0;
      padding-bottom: 0;
    }
    .sb-admonition-type::before {
      margin-right: 0;
    }
    .sb-table-widget {
      border: 0;
      border-radius: 4px 4px 0 0;
      background: none;
      box-shadow: none;
      overflow: auto;
    }
    .sb-lua-directive-block:has(> table, > * > table) {
      border: 1px solid var(--editor-widget-background-color);
      border-radius: 5px;
      background: none;
      box-shadow: none;
      overflow: visible;
    }
    .sb-lua-directive-block {
      border-radius: 5px;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) table {
      border-collapse: revert;
      font-size: revert;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) :is(td, th) {
      padding: 8px;
      border-bottom: 0;
      text-align: revert;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) thead td {
      padding: 11px 8px;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) thead :is(td, th) {
      font-size: inherit;
      font-weight: inherit;
      border-bottom: 0;
    }
    :is(.sb-table-widget, .sb-lua-directive-block)
      :is(thead td, thead th, tbody tr:nth-child(even) td) {
      background: none;
      color: inherit;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) tbody td:first-child {
      font-weight: inherit;
    }
    .sb-lua-directive-block th {
      text-align: left;
      font-weight: revert;
      font-size: inherit;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) :is(.sb-table-align-left) {
      text-align: left;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) :is(.sb-table-align-right) {
      text-align: right;
    }
    :is(.sb-table-widget, .sb-lua-directive-block) :is(.sb-table-align-center) {
      text-align: center;
    }
    .sb-lua-directive-block td[data-table-cell-type="number"] {
      font-variant-numeric: normal;
    }
    .cm-tooltip-autocomplete {
      border-radius: 0;
      padding: 0;
      box-shadow: none;
      overflow: visible;
    }
    .cm-tooltip-autocomplete > ul {
      font-family: monospace;
      font-size: inherit;
    }
    .cm-tooltip-autocomplete > ul > li {
      border-radius: 0;
      padding: 1px 3px;
    }
    .sb-lua-directive-inline
      :is(.sb-in-text, .sb-in-number, .sb-in-date, .sb-in-select) {
      font-family: inherit;
      font-size: inherit;
      padding: 2px 6px;
      border-color: transparent;
      border-radius: 4px;
      background: transparent;
    }
    .sb-lua-directive-inline
      :is(
        .sb-in-text:not(:focus), .sb-in-number, .sb-in-date, .sb-in-select
      ):hover {
      border-color: var(--ui-surface-border-color);
    }
    .sb-lua-directive-inline
      :is(.sb-in-text, .sb-in-number, .sb-in-date, .sb-in-select):focus {
      border-color: var(--text-field-focus-color);
    }
    .sb-lua-directive-inline .sb-in-date.sb-in-invalid {
      border-color: var(--danger-color);
    }
    .sb-page-widget-body ul {
      padding-left: revert;
    }
    .sb-page-widget-body :is(.sb-tree, .sb-tree ul[role="group"]) {
      padding-left: 0;
    }
    .sb-page-widget-body li + li {
      margin-top: 0;
    }
  }
  #sb-main
    .cm-editor
    :is(
      .sb-markdown-widget,
      .sb-lua-directive-block,
      .sb-lua-directive-inline,
      .sb-markdown-top-widget:has(*),
      .sb-markdown-bottom-widget:has(*),
      .sb-page-widget-content .sb-page-widget-body
    )
    button:not(
      .sb-button,
      .sb-button-primary,
      .sb-button-danger,
      .sb-button-icon,
      [class^="sb-in-"]
    ) {
    font-family: var(--editor-font);
    font-size: inherit;
    white-space: nowrap;
  }
  :is(.sb-markdown-widget, .sb-lua-directive-block, .sb-lua-directive-inline)
    .sb-fm-add-attr {
    padding: 0;
    border-radius: 0;
    background: none;
    color: var(--subtle-color);
    font-weight: inherit;
  }
  :is(.sb-markdown-widget, .sb-lua-directive-block, .sb-lua-directive-inline)
    .sb-fm-add-attr:hover {
    color: var(--root-color);
  }
  :where(.sb-markdown-widget, .sb-lua-directive-block, .sb-lua-directive-inline)
    :where(button:not([class])) {
    font-weight: revert;
    padding: revert;
    border: 1px solid var(--button-border-color);
    border-radius: 4px;
    background: var(--button-background-color);
    color: var(--button-color);
  }
  :where(.sb-markdown-widget, .sb-lua-directive-block, .sb-lua-directive-inline)
    :where(button:not([class]):hover) {
    background: var(--button-hover-background-color);
    color: var(--button-color);
  }
  .sb-footnote-tooltip {
    font: revert;
    line-height: revert;
    max-width: revert;
    padding: revert;
    color: revert;
    background: revert;
    border: revert;
    border-radius: revert;
    box-shadow: revert;
  }
  .sb-footnote-tooltip > :first-child {
    margin-top: revert;
  }
  .sb-footnote-tooltip > :last-child {
    margin-bottom: revert;
  }
  .cm-tooltip:has(> .sb-footnote-tooltip) {
    border: 1px solid #bbb;
    background: #f5f5f5;
  }
  &[data-sb-scheme="dark"] .cm-tooltip:has(> .sb-footnote-tooltip) {
    border: 0;
    background: #333338;
  }

  /* Widgets */
  .sb-in-dropdown {
    font-family: inherit;
    font-size: inherit;
    padding: 4px 0;
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
  }
  .sb-in-dropdown .sb-in-option {
    padding: 3px 10px;
    border-radius: 0;
  }
  .sb-in-chip.sb-hashtag {
    gap: normal;
    padding: 0;
  }
  .sb-in-chip .sb-in-x {
    display: revert;
    place-content: normal;
    width: auto;
    height: auto;
    padding: 0 4px 0 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    font-size: inherit;
    line-height: inherit;
    opacity: 0.6;
  }
  .sb-in-chip .sb-in-x:hover {
    background: none;
    color: var(--root-color);
  }
  .sb-frontmatter-preview .sb-fm-form {
    border: 1px solid var(--ui-surface-border-color);
    border-radius: 6px;
    padding: 4px 10px;
    column-gap: 12px;
  }
  :is(.sb-frontmatter-preview, .sb-data-block-preview) .sb-fm-form {
    font-family: inherit;
    font-size: 0.9em;
  }
  .sb-frontmatter-preview .sb-fm-key {
    font-weight: 600;
    color: var(--subtle-color);
  }
  .sb-page-widget {
    border-color: var(--editor-widget-background-color);
    border-radius: 5px;
    background: none;
    overflow: visible;
  }
  .sb-page-widget-bar {
    background: var(--editor-widget-background-color);
    border-bottom: 0;
    padding: 8px 10px;
  }
  .sb-page-widget-title {
    font-family: inherit;
    font-size: inherit;
    font-weight: bold;
    color: inherit;
  }
  .sb-page-widget-fold {
    color: inherit;
  }
  .sb-page-widget-body {
    padding: 10px;
    font-size: inherit;
  }
}
```

The find bar, code and frontmatter blocks, embeds and query-result tables keep their original rendering too:

```space-style
/* Find bar, code and frontmatter blocks, embeds, frontmatter keys, query tables and input radii: the original rendering */
:where(html[data-sb-theme^="Library/silverbulletmd/Themes/Classic/"]) {
  #sb-editor .cm-panels-bottom {
    background-color: color-mix(
      in srgb,
      var(--root-background-color),
      var(--subtle-color) 19.5%
    );
    .cm-search, .cm-dialog {
      font-family: inherit;
      font-size: inherit;
    }
    .cm-search {
      padding: 2px 6px 4px;
    }
    .cm-search :is(input, button, label) {
      margin: 0.2em 0.6em 0.2em 0;
    }
    .cm-textfield {
      font-size: 70%;
      padding: 0.2em 0.5em;
      border-radius: 0;
    }
    .cm-textfield:focus-visible {
      border-color: var(--ui-surface-border-color);
      box-shadow: none;
      outline: 2px solid var(--ui-accent-color);
      outline-offset: -1px;
    }
    .cm-button, .cm-button:hover {
      font-size: 70%;
      font-weight: inherit;
      padding: 0.2em 1em;
      border-color: #888;
      border-radius: 1px;
      background: linear-gradient(
        color-mix(
          in srgb,
          var(--root-background-color),
          var(--ui-surface-border-color) 40%
        ),
        var(--ui-surface-border-color)
      );
    }
    .cm-button:active {
      background: linear-gradient(
        color-mix(
          in srgb,
          var(--ui-surface-border-color),
          var(--subtle-color) 32%
        ),
        color-mix(
          in srgb,
          var(--ui-surface-border-color),
          var(--subtle-color) 7%
        )
      );
    }
    .cm-search label {
      display: inline;
      margin-left: 0;
      font-size: 80%;
      color: inherit;
    }
    .cm-search label input[type="checkbox"] {
      margin-right: 0.2em;
    }
    .cm-search button[name="close"], .cm-search button[name="close"]:hover {
      top: 0;
      right: 4px;
      transform: none;
      display: inline;
      width: auto;
      height: auto;
      border-radius: 0;
      background: inherit;
      font-size: inherit;
      color: inherit;
    }
  }
  #sb-main .cm-editor {
    .cm-line:is(.sb-line-fenced-code, .sb-line-code, .sb-frontmatter):not(
      .sb-fenced-code-iframe, .sb-fenced-code-hide
    ) {
      padding-left: var(--sb-indent);
      padding-right: 0;
    }
    .cm-line:is(.sb-line-fenced-code, .sb-line-code, .sb-frontmatter):not(
      .sb-fenced-code-iframe, .sb-fenced-code-hide
    )
      :is(.sb-code-info, .sb-frontmatter-marker) {
      padding-right: 7px;
    }
    .cm-line.sb-frontmatter:not(.sb-frontmatter + .sb-frontmatter),
    .cm-line.sb-frontmatter:not(:has(+ .sb-frontmatter)) {
      border-radius: 0;
    }
    .cm-line.sb-frontmatter :is(.sb-atom, .sb-attribute-name) {
      color: var(--editor-code-atom-color);
      font-weight: inherit;
    }
    .sb-lua-directive-block:has(
      > table, > * > table, > div > .content > table:only-child, > div
        > .content
        > .wrapper:only-child
        > table:only-child
    ) {
      border: 1px solid var(--editor-widget-background-color);
      border-radius: 5px;
      background: none;
      box-shadow: none;
      overflow: visible;
    }
    .sb-inline-content.sb-lua-directive-block {
      border: 1px solid var(--editor-widget-background-color);
      min-height: 48px;
    }
    .sb-inline-content.sb-lua-directive-block:has(
      > div > .content > :is(img, video)
    ) {
      width: auto;
    }
    .sb-inline-content.sb-lua-directive-block
      > div
      > .content
      > :is(img, video) {
      border-radius: 0;
      outline: 0;
    }
    .sb-inline-content.sb-lua-directive-block:not(
      :has(> div > .content > :is(img, video, audio, object))
    ) {
      padding: 0;
      background: none;
      border-color: var(--editor-widget-background-color);
      border-radius: 5px;
    }
    .sb-inline-content.sb-lua-directive-block[data-sb-source]:not(
      :has(> div > .content > :is(img, video, audio, object))
    )::before {
      content: none;
    }
  }
  :is(
    .sb-in-text,
    .sb-in-number,
    .sb-in-date,
    .sb-in-select,
    .sb-in-date-button,
    .sb-in-chips
  ),
  .sb-in-show-links > .sb-in-linktext {
    border-radius: 4px;
  }
}
```

Revision diffs, the all-caps section labels in the Workbench and Object Graph, panel notices and Linked Mentions sources keep their original rendering as well:

```space-style
/* Revision diff, section labels, panel notices, mention sources: the original rendering */
:where(html[data-sb-theme^="Library/silverbulletmd/Themes/Classic/"]) {
  .sb-revision-preview-body {
    background: var(--ui-surface-section-background-color);
    border-radius: 0.5em;
    font-size: inherit;
    line-height: inherit;
  }
  :is(.sb-revision-preview-diff, .sb-choose-version-diff) {
    padding: 12px;
  }
  :is(.sb-revision-preview-diff, .sb-choose-version-diff) > div {
    padding: 0;
  }
  .sb-revision-diff-sign {
    width: 1ch;
  }
  .sb-revision-diff-add, .sb-revision-diff-add .sb-revision-diff-sign {
    color: var(--editor-code-inserted-color);
  }
  .sb-revision-diff-del, .sb-revision-diff-del .sb-revision-diff-sign {
    color: var(--editor-code-deleted-color);
  }
  .sb-revision-diff-hunk {
    background: none;
    font-weight: 600;
  }
  :is(.gv-section-title, .sb-wbd-section, .sb-wbq-group) {
    font-size: 11px;
    color: var(--subtle-color);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  :is(.sb-nav-error, .sb-nav-empty-state) {
    border-radius: 2px;
  }
  .sb-mention-source.sb-mention-source {
    font: inherit;
    font-weight: bold;
    color: inherit;
  }
  :is(#sb-main, body) .sb-mention-source.sb-mention-source a.wiki-link {
    font-weight: bold;
    color: var(--editor-wiki-link-page-color);
  }
}
```
