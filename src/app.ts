import {markdown} from "./markdown";
import {commonmark, mkLang} from "./markdown/markdown";

import {
    Decoration,
    DecorationSet,
    drawSelection,
    dropCursor,
    EditorView,
    highlightSpecialChars,
    keymap,
    ViewPlugin,
    ViewUpdate
} from '@codemirror/view';
import {history, historyKeymap} from '@codemirror/history';
import {foldKeymap} from '@codemirror/fold';
import {indentOnInput, syntaxTree} from '@codemirror/language';
import {indentWithTab, standardKeymap} from '@codemirror/commands';
import {bracketMatching} from '@codemirror/matchbrackets';
import {closeBrackets, closeBracketsKeymap} from '@codemirror/closebrackets';
import {searchKeymap} from '@codemirror/search';
import {autocompletion, completionKeymap} from '@codemirror/autocomplete';
import {rectangularSelection} from '@codemirror/rectangular-selection';
import {HighlightStyle, styleTags, Tag, tags as t} from '@codemirror/highlight';
import {lintKeymap} from '@codemirror/lint';
import {EditorSelection, EditorState, StateCommand, Transaction} from "@codemirror/state";
import {Text} from "@codemirror/text";
import {MarkdownConfig} from "@lezer/markdown";
import {commonmarkLanguage} from "@codemirror/lang-markdown";

const defaultMd = `# Custom Box Design
Some #time ago I (that's @zef.hemel) wrote [No More Boxes](https://zef.me/musing/no-more-boxes/). Let me finally follow up on that and share an approach that I’ve been using opportunistically here and there, primarily for roles that hadn’t been well defined yet.

Let me start out with a few [[principles]] are:

    Our starting point is that everybody is **different**, and we should _benefit_ from this fact rather than _suppress_ it. The goal is therefore to uncover every person’s [“essence,”](https://zef.me/musing/your-essence/) develop it and optimally integrate it into the larger organization.


And fenced

\`\`\`
Hello
\`\`\`

## Second lever

Steve Jobs famously said:

> It doesn't make sense to hire smart people and then tell them what to do. We hire smart people so they can tell _us_ what to do.
>
> Another thing

We can adapt this quote to personal development. Here’s how we can formulate this analogy:

A list:

* We can adapt this quote to personal development. Here’s how we can formulate this analogy. ANd some other non duplicate text. We can adapt this quote to personal development. Here’s how we can formulate this analogy. We can adapt this quote to personal development. Here’s **how** we can formulate this analogy.
* Another line

The role of management is to challenge and support people in this process, and provide them with relevant context (e.g. knowledge, experience, connections) they need.`

const WikiLinkTag = Tag.define();
const TagTag = Tag.define();
const MentionTag = Tag.define();

let mdStyle = HighlightStyle.define([
    {tag: t.heading1, class: "h1"},
    {tag: t.heading2, class: "h2"},
    {tag: t.link, class: "link"},
    {tag: t.meta, class: "meta"},
    {tag: t.quote, class: "quote"},
    {tag: t.monospace, class: "code"},
    {tag: t.url, class: "url"},
    {tag: WikiLinkTag, class: "wiki-link"},
    {tag: TagTag, class: "tag"},
    {tag: MentionTag, class: "mention"},
    {tag: t.emphasis, class: "emphasis"},
    {tag: t.strong, class: "strong"},
    {tag: t.atom, class: "atom"},
    {tag: t.bool, class: "bool"},
    {tag: t.url, class: "url"},
    {tag: t.inserted, class: "inserted"},
    {tag: t.deleted, class: "deleted"},
    {tag: t.literal, class: "literal"},
    {tag: t.list, class: "list"},
    {tag: t.definition, class: "li"},
    {tag: t.string, class: "string"},
    {tag: t.number, class: "number"},
    {tag: [t.regexp, t.escape, t.special(t.string)], class: "string2"},
    {tag: t.variableName, class: "variableName"},
    {tag: t.comment, class: "comment"},
    {tag: t.invalid, class: "invalid"},
    {tag: t.punctuation, class: "punctuation"}
]);

function insertMarker(marker: string): StateCommand {
    return ({state, dispatch}) => {
        const changes = state.changeByRange((range) => {
            const isBoldBefore = state.sliceDoc(range.from - marker.length, range.from) === marker;
            const isBoldAfter = state.sliceDoc(range.to, range.to + marker.length) === marker;
            const changes = [];

            changes.push(isBoldBefore ? {
                from: range.from - marker.length,
                to: range.from,
                insert: Text.of([''])
            } : {
                from: range.from,
                insert: Text.of([marker]),
            })

            changes.push(isBoldAfter ? {
                from: range.to,
                to: range.to + marker.length,
                insert: Text.of([''])
            } : {
                from: range.to,
                insert: Text.of([marker]),
            })

            const extendBefore = isBoldBefore ? -marker.length : marker.length;
            const extendAfter = isBoldAfter ? -marker.length : marker.length;

            return {
                changes,
                range: EditorSelection.range(range.from + extendBefore, range.to + extendAfter),
            }
        })

        dispatch(
            state.update(changes, {
                scrollIntoView: true,
                annotations: Transaction.userEvent.of('input'),
            })
        )

        return true
    };
}


interface WrapElement {
    selector: string;
    class: string;
}

function wrapLines(view: EditorView, wrapElements: WrapElement[]) {
    let widgets = [];
    for (let {from, to} of view.visibleRanges) {
        const doc = view.state.doc;
        syntaxTree(view.state).iterate({
            from, to,
            enter: (type, from, to) => {
                const bodyText = doc.sliceString(from, to);
                console.log("Enter", type.name, bodyText)
                for (let wrapElement of wrapElements) {
                    if (type.name == wrapElement.selector) {
                        const bodyText = doc.sliceString(from, to);
                        // console.log("Found", type.name, "with: ", bodyText);
                        let idx = from;
                        for (let line of bodyText.split("\n")) {
                            widgets.push(Decoration.line({
                                class: wrapElement.class,
                            }).range(doc.lineAt(idx).from));
                            idx += line.length + 1;
                        }
                    }
                }
            },
            leave(type, from: number, to: number) {
                console.log("Leaving", type.name);
            }
        });
    }
    console.log("All widgets", widgets)
    return Decoration.set(widgets);
}

const lineWrapper = (wrapElements: WrapElement[]) => ViewPlugin.fromClass(class {
    decorations: DecorationSet

    constructor(view: EditorView) {
        this.decorations = wrapLines(view, wrapElements);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = wrapLines(update.view, wrapElements)
        }
    }
}, {
    decorations: v => v.decorations,
});

const WikiLink: MarkdownConfig = {
    defineNodes: ["WikiLink"],
    parseInline: [{
        name: "WikiLink",
        parse(cx, next, pos) {
            let match: RegExpMatchArray | null
            if (next != 91 /* '[' */ || !(match = /^\[[^\]]+\]\]/.exec(cx.slice(pos + 1, cx.end)))) {
                return -1;
            }
            return cx.addElement(cx.elt("WikiLink", pos, pos + 1 + match[0].length))
        },
        after: "Emphasis"
    }]
}

const AtMention: MarkdownConfig = {
    defineNodes: ["AtMention"],
    parseInline: [{
        name: "AtMention",
        parse(cx, next, pos) {
            let match: RegExpMatchArray | null
            if (next != 64 /* '@' */ || !(match = /^[A-Za-z\.]+/.exec(cx.slice(pos + 1, cx.end)))) {
                return -1;
            }
            return cx.addElement(cx.elt("AtMention", pos, pos + 1 + match[0].length))
        },
        after: "Emphasis"
    }]
}

const TagLink: MarkdownConfig = {
    defineNodes: ["TagLink"],
    parseInline: [{
        name: "TagLink",
        parse(cx, next, pos) {
            let match: RegExpMatchArray | null
            if (next != 35 /* '#' */ || !(match = /^[A-Za-z\.]+/.exec(cx.slice(pos + 1, cx.end)))) {
                return -1;
            }
            return cx.addElement(cx.elt("TagLink", pos, pos + 1 + match[0].length))
        },
        after: "Emphasis"
    }]
}
const WikiMarkdown = commonmark.configure([WikiLink, AtMention, TagLink, {
    props: [
        styleTags({
            WikiLink: WikiLinkTag,
            AtMention: MentionTag,
            TagLink: TagTag,
        })
    ]
}])

/// Language support for [GFM](https://github.github.com/gfm/) plus
/// subscript, superscript, and emoji syntax.
export const myMarkdown = mkLang(WikiMarkdown)


let startState = EditorState.create({
    doc: defaultMd,
    extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        // EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        // defaultHighlightStyle.fallback,
        mdStyle,
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        lineWrapper([
            {selector: "ATXHeading1", class: "line-h1"},
            {selector: "ATXHeading2", class: "line-h2"},
            {selector: "ListItem", class: "line-li"},
            {selector: "Blockquote", class: "line-blockquote"},
            {selector: "CodeBlock", class: "line-code"},
            {selector: "FencedCode", class: "line-fenced-code"},
        ]),
        rectangularSelection(),
        keymap.of([
            ...closeBracketsKeymap,
            ...standardKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
            {
                key: "Ctrl-b",
                mac: "Cmd-b",
                run: insertMarker('**')
            },
            {
                key: "Ctrl-i",
                mac: "Cmd-i",
                run: insertMarker('_')
            }
        ]),
        EditorView.domEventHandlers({
            click: (event: MouseEvent, view: EditorView) => {
                if (event.metaKey || event.ctrlKey) {
                    console.log("Navigate click");
                    let coords = view.posAtCoords(event);
                    console.log("Coords", view.state.doc.sliceString(coords, coords + 1));
                    return false;
                }
            }
        }),
        markdown({
            base: myMarkdown,
        }),
        EditorView.lineWrapping
    ]
})

let view = new EditorView({
    state: startState,
    parent: document.getElementById('editor')
});

view.focus();
