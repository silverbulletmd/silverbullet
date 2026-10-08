#meta

# ADR frontmatter card
Styling for the `adr` tag's `renderFrontmatter` above. Open any [[ADR]] to see it.
```space-style
.adr-card {
  --adr-color: #8a8a8a;
  border: 1px solid var(--ui-surface-border-color);
  border-left: 4px solid var(--adr-color);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.9em;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.adr-accepted { --adr-color: #2f9e44; }
.adr-proposed { --adr-color: #e0a800; }
.adr-deprecated { --adr-color: #e8590c; }
.adr-rejected { --adr-color: #e03131; }
.adr-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  color: var(--subtle-color);
}
.adr-status {
  color: var(--adr-color);
  background: color-mix(in srgb, var(--adr-color) 15%, transparent);
  border-radius: 999px;
  padding: 0 10px;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.8em;
  letter-spacing: 0.04em;
}
.adr-stale { color: #e8590c; }
.adr-banner {
  background: color-mix(in srgb, var(--adr-color) 12%, transparent);
  border-radius: 4px;
  padding: 4px 8px;
  font-weight: 600;
}
.adr-row { display: flex; gap: 8px; }
.adr-label {
  flex: 0 0 6.5em;
  color: var(--subtle-color);
}
.adr-card p { margin: 0; display: inline; }
```
