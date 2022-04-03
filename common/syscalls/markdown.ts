import {SysCallMapping} from "../../plugos/system";
import {MarkdownTree, nodeAtPos, parse, render} from "../tree";

export function markdownSyscalls(): SysCallMapping {
    return {
        parse(ctx, text: string): MarkdownTree {
            return parse(text);
        },
        nodeAtPos(ctx, mdTree: MarkdownTree, pos: number): MarkdownTree | null {
            return nodeAtPos(mdTree, pos);
        },
        render(ctx, mdTree: MarkdownTree): string {
            return render(mdTree);
        },
    };
}
