import YAML from "js-yaml";

/** What a node holds; null for an empty value or an alias (`*name`) */
export type YamlNodeKind = "scalar" | "sequence" | "mapping" | null;

export type YamlSourceNode = {
  from: number;
  to: number;
  kind: YamlNodeKind;
  value: unknown;
  children: YamlSourceNode[];
};

export type YamlSourceEntry = {
  key: string;
  keyText: string;
  keyNode: YamlSourceNode;
  valueNode: YamlSourceNode;
};

/** Parser-decoded identities and source spans share the same parse. */
export function yamlSource(text: string): YamlSourceNode[] {
  const roots: YamlSourceNode[] = [];
  const stack: YamlSourceNode[] = [];
  YAML.loadAll(text, undefined, {
    listener(event, state) {
      if (event === "open") {
        const node: YamlSourceNode = {
          from: state.position,
          to: state.position,
          kind: null,
          value: undefined,
          children: [],
        };
        (stack.at(-1)?.children ?? roots).push(node);
        stack.push(node);
      } else {
        const node = stack.pop()!;
        node.to = Math.min(state.position, text.length);
        node.kind = state.kind as YamlNodeKind;
        node.value = state.result;
        if (node.kind === null && node.value === null) {
          node.from += /^[ \t]*/.exec(
            text.slice(node.from, node.to),
          )![0].length;
          node.to = node.from;
          return;
        }
        // composeNode opens before consuming separation and comments.
        const prefix = /^(?:\s|#[^\n]*(?:\n|$))*/.exec(
          text.slice(node.from, node.to),
        )![0];
        node.from += prefix.length;
        while (node.to > node.from && /\s/.test(text[node.to - 1])) node.to--;
      }
    },
  });
  return roots;
}

/**
 * The node itself, past any wrappers: js-yaml composes a flow collection at
 * block level, a sequence item and a tagged scalar twice, so the outer node
 * has one child of the same kind and source.
 */
export function unwrap(node: YamlSourceNode): YamlSourceNode {
  while (
    node.children.length === 1 &&
    node.children[0].kind === node.kind &&
    node.children[0].from === node.from &&
    node.children[0].to === node.to
  ) {
    node = node.children[0];
  }
  return node;
}

export function yamlEntries(
  text: string,
  node: YamlSourceNode,
): YamlSourceEntry[] {
  node = unwrap(node);
  if (node.kind !== "mapping") return [];
  const entries: YamlSourceEntry[] = [];
  // A mapping's children alternate key, value
  for (let i = 0; i + 1 < node.children.length; i += 2) {
    const keyNode = node.children[i];
    entries.push({
      key: String(keyNode.value),
      keyText: text.slice(keyNode.from, keyNode.to),
      keyNode,
      valueNode: node.children[i + 1],
    });
  }
  return entries;
}

export function yamlTopLevelEntries(text: string): YamlSourceEntry[] {
  return yamlSource(text).flatMap((node) => yamlEntries(text, node));
}

/** Decoded top-level keys in source order, including integer-like keys. */
export function yamlTopLevelKeys(text: string): string[] {
  return yamlTopLevelEntries(text).map((entry) => entry.key);
}

/** Every mapping entry, nested ones included, with its depth (0: top level) */
export function yamlAllEntries(
  text: string,
): (YamlSourceEntry & { depth: number })[] {
  const entries: (YamlSourceEntry & { depth: number })[] = [];
  const visit = (node: YamlSourceNode, depth: number) => {
    if (unwrap(node).kind !== "mapping") {
      for (const child of node.children) visit(child, depth + 1);
      return;
    }
    for (const entry of yamlEntries(text, node)) {
      entries.push({ ...entry, depth });
      visit(entry.valueNode, depth + 1);
    }
  };
  for (const root of yamlSource(text)) visit(root, 0);
  return entries;
}

/** The node and all nodes under it, depth first. */
export function yamlNodes(node: YamlSourceNode): YamlSourceNode[] {
  return [node, ...node.children.flatMap(yamlNodes)];
}
