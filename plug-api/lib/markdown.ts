import {
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";

/**
 * Strips markdown from a ParseTree
 */
export function stripMarkdown(
  tree: ParseTree,
): string {
  if (tree.type?.endsWith("Mark") || tree.type?.endsWith("Delimiter")) {
    return "";
  }

  const stripArray = (arr: ParseTree[]) => arr.map(stripMarkdown).join("");

  switch (tree.type) {
    case "Document":
    case "Emphasis":
    case "Highlight":
    case "Strikethrough":
    case "InlineCode":
    case "StrongEmphasis":
    case "Superscript":
    case "Subscript":
    case "Paragraph":
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
    case "Blockquote":
    case "BulletList":
    case "OrderedList":
    case "ListItem":
    case "Table":
    case "TableHeader":
    case "TableCell":
    case "TableRow":
    case "Task":
    case "HTMLTag": {
      return stripArray(tree.children!);
    }

    case "FencedCode":
    case "CodeBlock": {
      tree.children = tree.children!.filter((c) => c.type);
      return stripArray(tree.children!);
    }

    case "Link": {
      const linkTextChildren = tree.children!.slice(1, -4);
      return stripArray(linkTextChildren);
    }

    case "Image": {
      const altTextNode = findNodeOfType(tree, "WikiLinkAlias") ||
        tree.children![1];
      let altText = altTextNode && altTextNode.type !== "LinkMark"
        ? renderToText(altTextNode)
        : "<Image>";

      const dimReg = /\d*[^\|\s]*?[xX]\d*[^\|\s]*/.exec(altText);
      if (dimReg) {
        altText = altText.replace(dimReg[0], "").replace("|", "");
      }

      return altText;
    }

    case "WikiLink": {
      const aliasNode = findNodeOfType(tree, "WikiLinkAlias");

      let linkText;
      if (aliasNode) {
        linkText = aliasNode.children![0].text!;
      } else {
        const ref = findNodeOfType(tree, "WikiLinkPage")!.children![0].text!;
        linkText = ref.split("/").pop()!;
      }

      return linkText;
    }

    case "NakedURL": {
      const url = tree.children![0].text!;
      return url;
    }

    case "CommandLink": {
      const aliasNode = findNodeOfType(tree, "CommandLinkAlias");

      let command;
      if (aliasNode) {
        command = aliasNode.children![0].text!;
      } else {
        command = tree.children![1].children![0].text!;
      }

      return command;
    }

    case "TaskState": {
      return tree.children![1].text!;
    }

    case "Escape": {
      return tree.children![0].text!.slice(1);
    }

    case "CodeText":
    case "Entity": {
      return tree.children![0].text!;
    }

    case "TemplateDirective":
    case "DeadlineDate": {
      return renderToText(tree);
    }

    case "CodeInfo":
    case "CommentBlock":
    case "FrontMatter":
    case "Hashtag":
    case "HardBreak":
    case "HorizontalRule":
    case "NamedAnchor":
    case "Attribute": {
      return "";
    }

    case undefined:
      return tree.text!;

    default:
      console.log("Unknown tree type: ", tree.type);
      return "";
  }
}
