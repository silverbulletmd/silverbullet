import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/closebrackets";
import { indentWithTab, standardKeymap } from "@codemirror/commands";
import { history, historyKeymap } from "@codemirror/history";
import { indentOnInput } from "@codemirror/language";
import { bracketMatching } from "@codemirror/matchbrackets";
import { searchKeymap } from "@codemirror/search";
import { EditorState, StateField } from "@codemirror/state";

import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import * as commands from "./commands";
import { markdown } from "./markdown";
import { lineWrapper } from "./lineWrapper";
import customMarkDown from "./parser";
import customMarkdownStyle from "./style";
import { HttpFileSystem } from "./fs";

import ReactDOM from "react-dom";
import { MutableRefObject, useEffect, useRef, useState } from "react";

const fs = new HttpFileSystem("http://localhost:2222/fs");

type AppState = {
  currentNote: string;
};

class Editor {
  view: EditorView;
  currentNote: string;

  constructor(parent: Element, currentNote: string, text: string) {
    this.view = new EditorView({
      state: this.createEditorState(text),
      parent: parent,
    });
    this.currentNote = currentNote;
  }

  load(name: string, text: string) {
    this.currentNote = name;
    this.view.setState(this.createEditorState(text));
  }

  async save() {
    await fs.writeNote(this.currentNote, this.view.state.sliceDoc());
  }

  focus() {
    this.view.focus();
  }

  private createEditorState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        customMarkdownStyle,
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        EditorView.lineWrapping,
        lineWrapper([
          { selector: "ATXHeading1", class: "line-h1" },
          { selector: "ATXHeading2", class: "line-h2" },
          { selector: "ListItem", class: "line-li" },
          { selector: "Blockquote", class: "line-blockquote" },
          { selector: "CodeBlock", class: "line-code" },
          { selector: "FencedCode", class: "line-fenced-code" },
        ]),
        keymap.of([
          ...closeBracketsKeymap,
          ...standardKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
          {
            key: "Ctrl-b",
            mac: "Cmd-b",
            run: commands.insertMarker("**"),
          },
          {
            key: "Ctrl-i",
            mac: "Cmd-i",
            run: commands.insertMarker("_"),
          },
          {
            key: "Ctrl-s",
            mac: "Cmd-s",
            run: (target: EditorView): boolean => {
              Promise.resolve()
                .then(async () => {
                  console.log("Saving");
                  await this.save();
                })
                .catch((e) => console.error(e));
              return true;
            },
          },
        ]),
        EditorView.domEventHandlers({
          click: (event: MouseEvent, view: EditorView) => {
            if (event.metaKey || event.ctrlKey) {
              console.log("Navigate click");
              let coords = view.posAtCoords(event);
              console.log(
                "Coords",
                view.state.doc.sliceString(coords!, coords! + 1)
              );
              return false;
            }
          },
        }),
        markdown({
          base: customMarkDown,
        }),
        StateField.define({
          create: () => null,
          update: (value, transaction) => {
            if (transaction.docChanged) {
              console.log("Something changed");
            }
            return null;
          },
        }),
      ],
    });
  }
}

function TopBar({ editor }: { editor: Editor | null }) {
  return (
    <div id="top">
      This is the top bar, do something cool: {editor?.currentNote}
    </div>
  );
}

function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    let editor = new Editor(editorRef.current!, "", "");
    editor.focus();
    // @ts-ignore
    window.editor = editor;
    fs.readNote("start").then((text) => {
      editor.load("start", text);
    });
    setEditor(editor);
  }, []);

  return (
    <>
      <TopBar editor={editor} />
      <div id="editor" ref={editorRef}></div>
      <div id="bottom">Bottom</div>
    </>
  );
}

ReactDOM.render(<App />, document.body);
