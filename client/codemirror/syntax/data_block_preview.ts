import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import YAML from "js-yaml";
import {
  dataBlockTag,
  dataObjectRef,
  splitYamlDocuments,
} from "../../../plugs/index/data_block.ts";
import type { Client } from "../../client.ts";
import {
  hookLookup,
  type LiveDocument,
  normalizeTags,
  type ObjectPreview,
  type ObjectPreviewHost,
  objectPreviewField,
  type ObjectRenderer,
  type PreviewObject,
  previewsEnabled,
  selectionShowsSource,
  yamlContext,
} from "./object_preview.ts";

export type DataBlockSource = {
  from: number;
  to: number;
  source: string;
  /** The fence's language: `data` or `#tag` */
  lang: string;
  /** The objects' root tag */
  tag: string;
  /** Each YAML document, split on `---` lines as the indexer does */
  documents: LiveDocument[];
};

/** A closed ```data or ```#tag block that fills whole lines */
function dataBlockSource(
  state: EditorState,
  node: { from: number; to: number; node: any },
): DataBlockSource | undefined {
  const info = node.node.getChild("CodeInfo");
  const marks = node.node.getChildren("CodeMark");
  if (!info || marks.length < 2) return;
  const lang = state.sliceDoc(info.from, info.to);
  const tag = dataBlockTag(lang);
  if (!tag) return;
  // A fence inside a list item or quote doesn't start its line; replacing
  // part of a line with a block widget would break the layout
  if (
    state.doc.lineAt(node.from).from !== node.from ||
    state.doc.lineAt(node.to).to !== node.to
  ) {
    return;
  }
  const code = node.node.getChild("CodeText");
  const documents = code
    ? splitYamlDocuments(state.sliceDoc(code.from, code.to)).map((part) => ({
        from: code.from + part.offset,
        text: part.text,
      }))
    : [];
  return {
    from: node.from,
    to: node.to,
    source: state.sliceDoc(node.from, node.to),
    lang,
    tag,
    documents,
  };
}

export function findDataBlocks(state: EditorState): DataBlockSource[] {
  const blocks: DataBlockSource[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const block = dataBlockSource(state, node);
      if (block) blocks.push(block);
      return false;
    },
  });
  return blocks;
}

/** The data block at (or around) `pos` in the current state */
export function dataBlockAt(
  state: EditorState,
  pos: number,
): DataBlockSource | undefined {
  let found: DataBlockSource | undefined;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (found) return false;
      if (node.name !== "FencedCode") return;
      found = dataBlockSource(state, node);
      return false;
    },
  });
  return found;
}

const INVALID = Symbol("invalid YAML");

/** A document's YAML value, or INVALID when it doesn't parse */
function loadDocument(text: string): unknown {
  try {
    return YAML.load(text);
  } catch {
    return INVALID;
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * One preview object per non-empty YAML document, shaped like the indexed
 * data object. Undefined when a document isn't a YAML mapping: the source
 * shows then, where the problem can be fixed.
 */
export function dataBlockObjects(
  block: DataBlockSource,
  page: string,
): PreviewObject[] | undefined {
  const objects: PreviewObject[] = [];
  for (const [index, doc] of block.documents.entries()) {
    const loaded = loadDocument(doc.text);
    if (loaded === INVALID) return;
    // An empty document is no object, as in the index
    if (loaded === null || loaded === undefined) continue;
    if (!isMapping(loaded)) return;
    const { context, parsed } = yamlContext(loaded, doc.text);
    objects.push({
      index,
      object: {
        ...parsed,
        ref: dataObjectRef(page, doc.from, loaded),
        tag: block.tag,
        tags: normalizeTags(parsed.tags),
        page,
      },
      context,
    });
  }
  return objects.length ? objects : undefined;
}

function hasCodeWidget(client: Client, lang: string): boolean {
  const system = client.clientSystem;
  return (
    !!system.luaCodeWidgets?.get(lang) ||
    !!system.codeWidgetHook?.codeWidgetCallbacks.get(lang)
  );
}

/** The data block's own tag's `renderDataBlock`, which beats code widgets */
function ownDataBlockRenderer(
  client: Client,
  lang: string,
): ObjectRenderer | undefined {
  const tag = dataBlockTag(lang);
  if (!tag || tag === "data") return;
  return hookLookup(client, "data")(tag);
}

/**
 * The renderer for a data block, first match wins: its tag's
 * `renderDataBlock`, a code widget for its language (rendered elsewhere, so
 * undefined here), the root `data` tag's `renderDataBlock`.
 */
export function selectDataBlockRenderer(
  client: Client,
  lang: string,
): ObjectRenderer | undefined {
  const own = ownDataBlockRenderer(client, lang);
  if (own) return own;
  if (hasCodeWidget(client, lang)) return;
  return hookLookup(client, "data")("data");
}

const dataBlockHost: ObjectPreviewHost = {
  kind: "data",
  className: "sb-data-block-preview",
  label: "Data block preview",
  documents: (state, from) => dataBlockAt(state, from)?.documents,
  target: (state, from, index, page) => {
    const block = dataBlockAt(state, from);
    const doc = block?.documents[index];
    if (!block || !doc) return;
    const loaded = loadDocument(doc.text);
    if (!isMapping(loaded)) return;
    // The current attributes identify the object, as an object from a query would
    return {
      ...loaded,
      page,
      ref: dataObjectRef(page, doc.from, loaded),
      tag: block.tag,
    };
  },
};

function blockPreview(
  state: EditorState,
  client: Client,
  block: DataBlockSource,
): ObjectPreview | undefined {
  if (selectionShowsSource(state, block.from, block.to)) return;
  const render = selectDataBlockRenderer(client, block.lang);
  if (!render) return;
  const page = client.currentName();
  const objects = dataBlockObjects(block, page);
  if (!objects) return;
  return {
    host: dataBlockHost,
    page,
    from: block.from,
    to: block.to,
    source: block.source,
    objects,
    render,
  };
}

export function dataBlockPreviewsForState(
  state: EditorState,
  client: Client,
): ObjectPreview[] {
  if (!previewsEnabled(client)) return [];
  return findDataBlocks(state).flatMap((block) => {
    const preview = blockPreview(state, client, block);
    return preview ? [preview] : [];
  });
}

/** Whether the data block preview shows the fenced block starting at `from` */
export function dataBlockPreviewShows(
  state: EditorState,
  client: Client,
  from: number,
): boolean {
  if (!previewsEnabled(client)) return false;
  const block = dataBlockAt(state, from);
  return !!block && block.from === from && !!blockPreview(state, client, block);
}

export function dataBlockPreviewPlugin(client: Client): Extension {
  return objectPreviewField(client, (state) =>
    dataBlockPreviewsForState(state, client),
  );
}
