import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';
function wrapLines(view, wrapElements) {
    let widgets = [];
    for (let { from, to } of view.visibleRanges) {
        const doc = view.state.doc;
        syntaxTree(view.state).iterate({
            from, to,
            enter: (type, from, to) => {
                const bodyText = doc.sliceString(from, to);
                // console.log("Enter", type.name, bodyText);
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
            leave(type, from, to) {
                // console.log("Leaving", type.name);
            }
        });
    }
    // console.log("All widgets", widgets);
    return Decoration.set(widgets);
}
export const lineWrapper = (wrapElements) => ViewPlugin.fromClass(class {
    constructor(view) {
        this.decorations = wrapLines(view, wrapElements);
    }
    update(update) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = wrapLines(update.view, wrapElements);
        }
    }
}, {
    decorations: v => v.decorations,
});
