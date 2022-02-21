import { styleTags } from '@codemirror/highlight';
import { commonmark, mkLang } from "./markdown/markdown";
import * as ct from './customtags';
const WikiLink = {
    defineNodes: ["WikiLink"],
    parseInline: [{
            name: "WikiLink",
            parse(cx, next, pos) {
                let match;
                if (next != 91 /* '[' */ || !(match = /^\[[^\]]+\]\]/.exec(cx.slice(pos + 1, cx.end)))) {
                    return -1;
                }
                return cx.addElement(cx.elt("WikiLink", pos, pos + 1 + match[0].length));
            },
            after: "Emphasis"
        }]
};
const AtMention = {
    defineNodes: ["AtMention"],
    parseInline: [{
            name: "AtMention",
            parse(cx, next, pos) {
                let match;
                if (next != 64 /* '@' */ || !(match = /^[A-Za-z\.]+/.exec(cx.slice(pos + 1, cx.end)))) {
                    return -1;
                }
                return cx.addElement(cx.elt("AtMention", pos, pos + 1 + match[0].length));
            },
            after: "Emphasis"
        }]
};
const TagLink = {
    defineNodes: ["TagLink"],
    parseInline: [{
            name: "TagLink",
            parse(cx, next, pos) {
                let match;
                if (next != 35 /* '#' */ || !(match = /^[A-Za-z\.]+/.exec(cx.slice(pos + 1, cx.end)))) {
                    return -1;
                }
                return cx.addElement(cx.elt("TagLink", pos, pos + 1 + match[0].length));
            },
            after: "Emphasis"
        }]
};
const WikiMarkdown = commonmark.configure([WikiLink, AtMention, TagLink, {
        props: [
            styleTags({
                WikiLink: ct.WikiLinkTag,
                AtMention: ct.MentionTag,
                TagLink: ct.TagTag,
            })
        ]
    }]);
/// Language support for [GFM](https://github.github.com/gfm/) plus
/// subscript, superscript, and emoji syntax.
export default mkLang(WikiMarkdown);
