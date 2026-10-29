import YAML from "js-yaml";

export type YamlSourceNode = {
  from: number;
  to: number;
  kind: string | null;
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
        node.kind = state.kind;
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

export function yamlEntries(
  text: string,
  node: YamlSourceNode,
): YamlSourceEntry[] {
  if (node.kind !== "mapping") return [];
  if (node.children.length === 1) return yamlEntries(text, node.children[0]);
  const entries: YamlSourceEntry[] = [];
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

/** Scalar wrappers emitted for sequence items describe the same source. */
export function yamlScalars(node: YamlSourceNode): YamlSourceNode[] {
  if (node.kind === "scalar") return [node];
  return node.children.flatMap(yamlScalars);
}
