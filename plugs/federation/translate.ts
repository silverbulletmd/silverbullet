import { ParseTree, renderToText, replaceNodesMatching } from "$sb/lib/tree.ts";

export const federatedPrefix = "!";

const scopableQuerySources: Record<string, string> = {
  "page": "name",
  "data": "page",
  "task": "page",
};

export function translateLinksWithPrefix(
  tree: ParseTree,
  prefix: string,
) {
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Add the prefix in the link text
      const pageName = tree.children![0].text!;
      if (!pageName.startsWith(federatedPrefix) && !pageName.startsWith("{{")) {
        // Only for links that aren't already federation links
        tree.children![0].text = prefix + pageName;
      }
    }
    if (tree.type === "PageRef") {
      // Shape: [[pageref]] occur in queries
      // Add the prefix in the link text
      tree.children![0].text = injectFederationLinks(
        tree.children![0].text!,
        prefix,
      );
    }
    if (tree.type === "DirectiveStart" && tree.children![0].text) {
      // #use or #include
      tree.children![0].text = injectFederationLinks(
        tree.children![0].text!,
        prefix,
      );
    }

    if (tree.type === "Query") {
      const source = tree.children![0].children![0].text!;
      if (scopableQuerySources[source]) {
        // This is a rather hacky way of injecting an additional where clause to filter on only the federated pages
        tree.children![0].children!.splice(1, 0, {
          "from": 0,
          "to": 0,
          "text": ` where ${scopableQuerySources[source]} =~ /^${
            escapeRegex(prefix)
          }/`,
        });
      }
    }

    return undefined;
  });
  return tree;
}

export function translateLinksWithoutPrefix(
  tree: ParseTree,
  prefix: string,
) {
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Remove the prefix in the link text
      const text = tree.children![0].text!;
      if (text.startsWith(prefix)) {
        tree.children![0].text = text.substring(prefix.length);
      }
    }
    if (tree.type === "PageRef") {
      // Shape: [[pageref]] occur in queries
      // Add the prefix in the link text
      tree.children![0].text = removeFederationLinks(
        tree.children![0].text!,
        prefix,
      );
    }
    if (tree.type === "DirectiveStart" && tree.children![0].text) {
      // #use or #include
      tree.children![0].text = removeFederationLinks(
        tree.children![0].text!,
        prefix,
      );
    }

    if (tree.type === "Query") {
      const source = tree.children![0].children![0].text!;
      const potentialWhereClause = tree.children![2];
      if (scopableQuerySources[source] && potentialWhereClause) {
        const whereText = renderToText(potentialWhereClause);
        if (
          whereText ===
            `where ${scopableQuerySources[source]} =~ /^${escapeRegex(prefix)}/`
        ) {
          tree.children!.splice(1, 2); // 1 = space, 2 = where clause
        }
      }
    }
    return undefined;
  });
  return tree;
}

function injectFederationLinks(text: string, prefix: string): string {
  return text.replaceAll(/\[\[(?!(!|https?:))/g, `[[${prefix}$1`);
}

function escapeRegex(text: string): string {
  return text.replaceAll(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function removeFederationLinks(text: string, prefix: string): string {
  return text.replaceAll(
    new RegExp("\\[\\[" + escapeRegex(prefix), "g"),
    "[[",
  );
}
