import { 
    Facet,
    EditorView,
    Extension,
    Decoration,
    RangeSetBuilder,
    ViewPlugin,
    DecorationSet,
    ViewUpdate } from "./deps.ts";
  
    const baseTheme = EditorView.baseTheme({
      "&light .cm-zebraStripe": {backgroundColor: "#d4fafa"},
      "&dark .cm-zebraStripe": {backgroundColor: "#1a2727"}
    })
  
    const stepSize = Facet.define<number, number>({
      combine: values => values.length ? Math.min(...values) : 1
    })
    
    export function activeLines(options: {step?: number} = {}): Extension {
      return [
        baseTheme,
        options.step == null ? [] : stepSize.of(options.step),
        addClass
      ]
    }
  
    const activeLine = Decoration.line({
      attributes: {class: "sb-activeLine"}
    })
    
    function activeLineDeco(view: EditorView) {
      let step = view.state.facet(stepSize)
      let builder = new RangeSetBuilder<Decoration>()

      for (let {from, to} of view.state.selection.ranges) {
        for (let pos = from; pos <= to;) {
          let line = view.state.doc.lineAt(pos)
          if ((line.number % step) == 0)
            builder.add(line.from, line.from, activeLine)
          pos = line.to + 1
        }
      }
      return builder.finish()
    }
  
    const addClass = ViewPlugin.fromClass(class {
      decorations: DecorationSet
    
      constructor(view: EditorView) {
        this.decorations = activeLineDeco(view)
      }
    
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet)
          this.decorations = activeLineDeco(update.view)
      }
    }, {
      decorations: v => v.decorations
    })