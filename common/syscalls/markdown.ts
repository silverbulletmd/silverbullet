import {SysCallMapping} from "../../plugos/system";
import {MarkdownTree, nodeAtPos, parse, render} from "../tree";

export function markdownSyscalls(): SysCallMapping {
    return {
        "markdown.parse": (ctx, text: string): MarkdownTree => {
            return parse(text);
        },
        "markdown.nodeAtPos": (ctx, mdTree: MarkdownTree, pos: number): MarkdownTree | null => {
            return nodeAtPos(mdTree, pos);
        },
        "markdown.render": (ctx, mdTree: MarkdownTree): string  => {
            return render(mdTree);
        },
    };
}
