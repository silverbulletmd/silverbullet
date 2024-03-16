import {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  MarkdownConfig,
} from "@lezer/markdown";

import { tags as t } from "@lezer/highlight";
import { TaskStateTag } from "./customtags.ts";

// Taken from https://github.com/lezer-parser/markdown/blob/main/src/extension.ts and adapted

class MultiStatusTaskParser implements LeafBlockParser {
  constructor(private status: string) {
  }

  nextLine() {
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    cx.addLeafElement(
      leaf,
      cx.elt("Task", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("TaskState", leaf.start, leaf.start + 2 + this.status.length, [
          cx.elt("TaskMark", leaf.start, leaf.start + 1),
          cx.elt(
            "TaskMark",
            leaf.start + 1 + this.status.length,
            leaf.start + 2 + this.status.length,
          ),
        ]),
        ...cx.parser.parseInline(
          leaf.content.slice(this.status.length + 2),
          leaf.start + this.status.length + 2,
        ),
      ]),
    );
    return true;
  }
}

export const TaskList: MarkdownConfig = {
  defineNodes: [
    { name: "Task", block: true, style: t.list },
    { name: "TaskMark", style: t.atom },
    { name: "TaskState", style: TaskStateTag },
  ],
  parseBlock: [{
    name: "TaskList",
    leaf(cx, leaf) {
      const match = /^\[([^\]]+)\][ \t]/.exec(leaf.content);
      return match &&
          cx.parentType().name == "ListItem"
        ? new MultiStatusTaskParser(match[1])
        : null;
    },
    after: "SetextHeading",
  }],
};
