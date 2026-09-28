#!/usr/bin/env python3
from pathlib import Path
import hashlib
import sys
import urllib.request

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

EXPECTED_BLOBS = {
    "client/codemirror/frontmatter_folding.ts": "2e615a57d294d83a7e00a328b6b9e5bca086024f",
    "client/codemirror/editor_state.ts": "36223bb77be082104b0448457ac88ff8160ff97e",
    "client/codemirror/frontmatter_folding.test.ts": "7e6487580a0654d19165115d6c61c19af5ed176d",
    "client/styles/editor.scss": "21751e512e95666e22c3e567f4dd3382392ceab6",
    "libraries/Library/Std/Config.md": "c377bcf20cdeb231dc46b30d80ce58cff5ebd621",
    "docs/Frontmatter.md": "2625325c2e05f98348b6801f293e89793cbd3a3e",
    "docs/CHANGELOG.md": "faa596d95794b0de99b04a3a56093024be562f13",
}

OVERLAY_URL = (
    "https://raw.githubusercontent.com/marco10x15/SilverBullet-test/"
    "6b107ece3bf0b5b5114c0338e7d8153f509bfd0c/"
    "overlay/client/codemirror/frontmatter_folding.ts"
)

def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()

def require_source_tree() -> None:
    if not (ROOT / "package.json").exists():
        raise SystemExit(f"Not a SilverBullet source tree: {ROOT}")

def require_expected_files() -> None:
    mismatches = []
    for rel, expected in EXPECTED_BLOBS.items():
        p = ROOT / rel
        if not p.exists():
            mismatches.append(f"{rel}: missing")
            continue
        actual = git_blob_sha(p.read_bytes())
        if actual != expected:
            mismatches.append(f"{rel}: expected {expected}, got {actual}")
    if mismatches:
        raise SystemExit(
            "Source tree is not the verified upstream main snapshot.\n"
            "Sync/recreate the branch before applying this port:\n- "
            + "\n- ".join(mismatches)
        )

def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"Patch anchor count={count}, expected=1 ({label}) in {path}"
        )
    path.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patched: {path.relative_to(ROOT)} ({label})")

require_source_tree()
require_expected_files()

with urllib.request.urlopen(OVERLAY_URL, timeout=30) as response:
    implementation = response.read().decode("utf-8")
(ROOT / "client/codemirror/frontmatter_folding.ts").write_text(
    implementation, encoding="utf-8"
)
print("replaced: client/codemirror/frontmatter_folding.ts")

path = ROOT / "client/codemirror/editor_state.ts"
replace_once(
    path,
    '''import {
  frontmatterFoldingExtension,
  frontmatterFoldPlaceholderDOM,
  prepareFrontmatterFoldPlaceholder,
} from "./frontmatter_folding.ts";''',
    '''import {
  clientFrontmatterFoldingConfig,
  frontmatterFoldingExtension,
  frontmatterFoldPlaceholderDOM,
  prepareFrontmatterFoldPlaceholder,
} from "./frontmatter_folding.ts";''',
    "editor_state import",
)
replace_once(
    path,
    '''    codeFolding({
      preparePlaceholder: prepareFrontmatterFoldPlaceholder,
      placeholderDOM: (view, onclick, prepared) =>
        frontmatterFoldPlaceholderDOM(view, onclick, prepared, client),
    }),''',
    '''    codeFolding({
      preparePlaceholder: (state, range) =>
        prepareFrontmatterFoldPlaceholder(
          state,
          range,
          clientFrontmatterFoldingConfig(client),
        ),
      placeholderDOM: (view, onclick, prepared) =>
        frontmatterFoldPlaceholderDOM(view, onclick, prepared, client),
    }),''',
    "editor_state folding callback",
)

path = ROOT / "libraries/Library/Std/Config.md"
old = '''    foldByDefaultLines = {
      type = "number",
      default = 5,
      minimum = 1,
      multipleOf = 1,
      description = "Fold frontmatter automatically when it has more than this positive whole number of lines and auto-fold is set to long",
      ui = { category = "Editor", label = "Frontmatter auto-fold lines", priority = -2 },
    },
'''
new = old + '''    preview = {
      type = "array",
      description = "Fields to render while frontmatter is folded",
      items = {
        type = "object",
        properties = {
          field = {
            type = "string",
            description = "Frontmatter field to render",
          },
          type = {
            type = "string",
            enum = { "text", "markdown", "tags", "date" },
            default = "text",
            description = "How to render the field value",
          },
          template = {
            type = "string",
            default = "${value}",
            description = "Template used to render the field value",
          },
          separator = {
            type = "string",
            default = ", ",
            description = "Separator used for array values",
          },
        },
        required = { "field" },
        additionalProperties = false,
      },
    },
'''
replace_once(path, old, new, "frontmatterFolding preview schema")

path = ROOT / "client/styles/editor.scss"
old = '''  .cm-frontmatterFoldPlaceholder {
    box-sizing: border-box;
    cursor: pointer;
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    padding: 2px 7px !important;
    user-select: none;
    width: 100%;
  }

  .cm-frontmatterFoldStatus {
    color: var(--subtle-color);
    font-size: 0.85em;
    margin-left: 0.4em;
    opacity: 0.75;
  }
'''
new = '''  .cm-frontmatterFoldPlaceholder {
    box-sizing: border-box;
    cursor: pointer;
    display: inline-flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    padding: 2px 7px !important;
    user-select: none;
    width: 100%;
  }

  .cm-frontmatterPreview {
    display: block;
    width: 100%;
    white-space: normal;
  }

  .cm-frontmatterPreview-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .cm-frontmatterPreviewHeading {
    display: block;
    font-weight: bold;
  }

  .cm-frontmatterPreviewHeading-1 {
    font-size: 2em;
    line-height: 1.2;
    margin: 0.25em 0;
  }

  .cm-frontmatterPreviewHeading-2 {
    font-size: 1.5em;
    line-height: 1.25;
  }

  .cm-frontmatterPreview-markdown .wrapper {
    display: contents;
  }

  .cm-frontmatterFoldStatus {
    color: var(--subtle-color);
    font-size: 0.85em;
    opacity: 0.75;
  }
'''
replace_once(path, old, new, "frontmatter preview CSS")

path = ROOT / "client/codemirror/frontmatter_folding.test.ts"
text = path.read_text(encoding="utf-8")

def test_replace(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Test patch anchor count={count}, expected=1 ({label})")
    text = text.replace(old, new)
    print(f"patched test: {label}")

test_replace(
    '''  frontmatterFoldPlaceholderText,
  frontmatterFoldTags,
''',
    '''  frontmatterFoldPlaceholderText,
  frontmatterFoldTags,
  formatFrontmatterDate,
''',
    "import date formatter",
)
test_replace(
    '      foldByDefaultLines: 12,\n    });',
    '      foldByDefaultLines: 12,\n'
    '      preview: [\n'
    '        {\n'
    '          field: "tags",\n'
    '          type: "tags",\n'
    '          template: "${value}",\n'
    '          separator: " ",\n'
    '        },\n'
    '      ],\n'
    '    });',
    "partial config includes default preview",
)
test_replace(
    '      foldByDefaultLines: 5,\n    });',
    '      foldByDefaultLines: 5,\n'
    '      preview: [\n'
    '        {\n'
    '          field: "tags",\n'
    '          type: "tags",\n'
    '          template: "${value}",\n'
    '          separator: " ",\n'
    '        },\n'
    '      ],\n'
    '    });',
    "default config includes preview",
)
test_replace(
    '      lines: 4,\n      tags: [],\n    });',
    '      lines: 4,\n      preview: [],\n    });',
    "prepared placeholder uses preview",
)
test_replace(
    '        lines: 4,\n        tags: [],\n      }),',
    '        lines: 4,\n        preview: [],\n      }),',
    "placeholder text test uses preview",
)
test_replace(
    '{ type: "frontmatter", from: 0, to: 17, editPos: 4, lines: 4, tags: [] },',
    '{ type: "frontmatter", from: 0, to: 17, editPos: 4, lines: 4, preview: [] },',
    "DOM empty placeholder uses preview",
)
test_replace(
    '        lines: 4,\n        tags: ["feature", "beta"],\n      },',
    '        lines: 4,\n'
    '        preview: [\n'
    '          {\n'
    '            config: {\n'
    '              field: "tags",\n'
    '              type: "tags",\n'
    '              template: "${value}",\n'
    '              separator: " ",\n'
    '            },\n'
    '            value: ["feature", "beta"],\n'
    '          },\n'
    '        ],\n'
    '      },',
    "DOM tags preview",
)
test_replace(
    '          lines: 4,\n          tags: ["feature"],\n        },\n        {\n          config: {',
    '          lines: 4,\n'
    '          preview: [\n'
    '            {\n'
    '              config: {\n'
    '                field: "tags",\n'
    '                type: "tags",\n'
    '                template: "${value}",\n'
    '                separator: " ",\n'
    '              },\n'
    '              value: ["feature"],\n'
    '            },\n'
    '          ],\n'
    '        },\n'
    '        {\n'
    '          config: {',
    "tag navigation preview",
)
test_replace(
    '          lines: 4,\n          tags: ["feature"],\n        },\n      );',
    '          lines: 4,\n'
    '          preview: [\n'
    '            {\n'
    '              config: {\n'
    '                field: "tags",\n'
    '                type: "tags",\n'
    '                template: "${value}",\n'
    '                separator: " ",\n'
    '              },\n'
    '              value: ["feature"],\n'
    '            },\n'
    '          ],\n'
    '        },\n'
    '      );',
    "background click preview",
)

marker = 'describe("frontmatter folding defaults", () => {'
extra = r'''  test("normalizes explicit preview entries and preserves empty preview", () => {
    expect(
      normalizeFrontmatterFoldingConfig({
        preview: [
          { field: "description" },
          { field: "tags", type: "tags" },
        ],
      }).preview,
    ).toEqual([
      {
        field: "description",
        type: "text",
        template: "${value}",
        separator: ", ",
      },
      {
        field: "tags",
        type: "tags",
        template: "${value}",
        separator: " ",
      },
    ]);
    expect(normalizeFrontmatterFoldingConfig({ preview: [] }).preview).toEqual(
      [],
    );
  });

  test("formats valid ISO dates and rejects unsupported strings", () => {
    expect(formatFrontmatterDate("2026-09-28")).toBe("28.09.2026");
    expect(formatFrontmatterDate("28/09/2026")).toBeUndefined();
  });

'''
if text.count(marker) != 1:
    raise SystemExit("Could not locate test insertion point")
text = text.replace(marker, extra + marker)

marker2 = '  test("extracts folded frontmatter tags from scalar and list values", () => {'
extra2 = r'''  test("extracts configured preview values in configuration order", () => {
    const state = stateWithDoc(
      "---\ndisplayName: Torino\ndescription: Test\ntags: feature\n---\nBody",
    );
    const block = findFrontmatterBlock(state)!;
    const config = normalizeFrontmatterFoldingConfig({
      preview: [
        { field: "displayName", type: "markdown", template: "# ${value}" },
        { field: "description", type: "text" },
        { field: "missing", type: "text" },
      ],
    });

    const prepared = prepareFrontmatterFoldPlaceholder(
      state,
      { from: block.from, to: block.to },
      config,
    );

    expect(prepared.type).toBe("frontmatter");
    if (prepared.type === "frontmatter") {
      expect(prepared.preview.map((item) => item.config.field)).toEqual([
        "displayName",
        "description",
      ]);
      expect(prepared.preview.map((item) => item.value)).toEqual([
        "Torino",
        "Test",
      ]);
    }
  });

'''
if text.count(marker2) != 1:
    raise SystemExit("Could not locate preview extraction test insertion point")
text = text.replace(marker2, extra2 + marker2)
path.write_text(text, encoding="utf-8")
print("patched: client/codemirror/frontmatter_folding.test.ts")

path = ROOT / "docs/Frontmatter.md"
text = path.read_text(encoding="utf-8")
start = text.index("# Folding\n")
end = text.index("# Special attributes\n")
folding = r'''# Folding
Frontmatter can be folded in the editor. By default, frontmatter blocks with more than 5 lines fold automatically when you open a page, unless your cursor or selection is inside the frontmatter. When folded, frontmatter with a `tags` key previews those tags as tag chips.

You can configure this in your [[CONFIG]] page with `frontmatterFolding`:

Never auto-fold frontmatter:

```lua
config.set("frontmatterFolding", {
  foldByDefault = "never",
})
```

Always auto-fold frontmatter:

```lua
config.set("frontmatterFolding", {
  foldByDefault = "always",
})
```

Only auto-fold frontmatter above a custom line threshold:

```lua
config.set("frontmatterFolding", {
  foldByDefault = "long",
  foldByDefaultLines = 10,
})
```

## Folded frontmatter preview

Use `frontmatterFolding.preview` to choose which frontmatter fields remain visible while the block is folded.

```lua
config.set("frontmatterFolding", {
  foldByDefault = "long",
  foldByDefaultLines = 5,
  preview = {
    { field = "displayName", type = "markdown", template = "# ${value}" },
    { field = "description", type = "text", template = "📒 ${value}" },
    { field = "date", type = "date", template = "📅 ${value}" },
    { field = "places", type = "markdown", template = "🗺️ ${value}", separator = " · " },
    { field = "tags", type = "tags" },
  },
})
```

Preview entries are rendered in configuration order.

| Property | Description |
| --- | --- |
| `field` | Frontmatter field to display |
| `type` | `text`, `markdown`, `tags`, or `date` |
| `template` | `${value}` is replaced by the rendered field value |
| `separator` | Separator for array values; defaults to `", "` (`" "` for tags) |

Missing and empty values are skipped. Scalar strings, numbers, and booleans are supported. Arrays are flattened and joined with `separator`. Complex YAML mappings are ignored.

### Preview types

`text`
: Renders plain text. Markdown and HTML are not interpreted.

`markdown`
: Uses SilverBullet's Markdown parser for presentation such as emphasis, WikiLinks, URLs, and heading-like styling. It does not run Space Lua, transclusions, or Markdown expansion. Heading-like content is presentation-only and does not add entries to the page outline or Table of Contents.

`tags`
: Uses the existing folded-frontmatter tag chips and navigation behavior.

`date`
: Renders ISO `YYYY-MM-DD` as `DD.MM.YYYY`. Invalid values are not shown.

If `preview` is omitted, SilverBullet keeps its existing tags-only behavior. An explicit empty `preview = {}` shows only the fold-status line.

Links and tags remain interactive. Clicking elsewhere in folded frontmatter unfolds it and places the cursor inside the frontmatter.

'''
path.write_text(text[:start] + folding + text[end:], encoding="utf-8")
print("patched: docs/Frontmatter.md")

path = ROOT / "docs/CHANGELOG.md"
text = path.read_text(encoding="utf-8")
anchor = '''## Edge
_These changes are available from the [edge builds](https://github.com/silverbulletmd/silverbullet/releases/tag/edge)_

'''
entry = '''* Folded frontmatter can now preview configured metadata fields, not only tags. `frontmatterFolding.preview` supports plain text, short Markdown, tags, dates, templates, and array separators while preserving the existing tags-only behavior by default.
'''
if text.count(anchor) != 1:
    raise SystemExit("Could not locate CHANGELOG Edge header")
path.write_text(text.replace(anchor, anchor + entry, 1), encoding="utf-8")
print("patched: docs/CHANGELOG.md")

print("\nPort completed.")
print("Review the diff, then run:")
print("  npm ci")
print("  make fmt")
print("  make check")
print("  make test")
