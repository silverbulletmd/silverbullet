import type { EditorState, Extension } from "@codemirror/state";
import type { Client } from "../../client.ts";
import { findFrontmatterBlock, parseFrontmatter } from "./frontmatter_block.ts";
import {
  hookLookup,
  normalizeTags,
  objectPreviewField,
  type ObjectPreview,
  type ObjectPreviewHost,
  type ObjectRenderer,
  previewsEnabled,
  type RendererLookup,
  selectionShowsSource,
  selectRenderer,
  withLineBreak,
  type YamlContext,
  yamlContext,
} from "./object_preview.ts";

export type FrontmatterPreviewSource = {
  from: number;
  to: number;
  source: string;
  pageMeta: Record<string, unknown>;
  context: YamlContext;
};

export function parseFrontmatterPreview(
  state: EditorState,
  pageName: string,
): FrontmatterPreviewSource | undefined {
  const frontmatter = parseFrontmatter(state);
  const loaded = frontmatter?.data;
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
    return;
  }
  try {
    const { context, parsed } = yamlContext(
      loaded as Record<string, unknown>,
      frontmatter.yaml,
    );
    return {
      from: frontmatter.from,
      to: frontmatter.to,
      source: frontmatter.source,
      pageMeta: {
        ...parsed,
        name: pageName,
        tags: normalizeTags(parsed.tags),
      },
      context,
    };
  } catch {
    return;
  }
}

export function selectFrontmatterRenderer(
  pageMeta: Record<string, unknown>,
  getRenderer: RendererLookup,
): ObjectRenderer | undefined {
  // Every page carries the root `page` tag, so its renderer is the default
  return selectRenderer(
    Array.isArray(pageMeta.tags) ? pageMeta.tags : [],
    "page",
    getRenderer,
  );
}

const frontmatterHost: ObjectPreviewHost = {
  kind: "page",
  className: "sb-frontmatter-preview",
  label: "Frontmatter preview",
  cornerLabel: "frontmatter",
  documents: (state) => {
    const frontmatter = parseFrontmatter(state);
    return (
      frontmatter && [{ from: frontmatter.yamlFrom, text: frontmatter.yaml }]
    );
  },
  // The frontmatter with the line break after it
  removal: (state) => {
    const block = findFrontmatterBlock(state);
    return block && withLineBreak(state, block.from, block.to);
  },
  target: (_state, _from, _index, page) => ({ page, ref: page }),
};

export function frontmatterPreviewForState(
  state: EditorState,
  client: Client,
): ObjectPreview | undefined {
  if (!previewsEnabled(client, state)) return;
  const page = client.currentName();
  const source = parseFrontmatterPreview(state, page);
  if (!source || selectionShowsSource(state, source.from, source.to)) {
    return;
  }
  const render = selectFrontmatterRenderer(
    source.pageMeta,
    hookLookup(client, "page"),
  );
  if (!render) return;
  return {
    host: frontmatterHost,
    page,
    from: source.from,
    to: source.to,
    source: source.source,
    objects: [{ index: 0, object: source.pageMeta, context: source.context }],
    render,
  };
}

export function frontmatterPreviewPlugin(client: Client): Extension {
  return objectPreviewField(client, (state) => {
    const preview = frontmatterPreviewForState(state, client);
    return preview ? [preview] : [];
  });
}
