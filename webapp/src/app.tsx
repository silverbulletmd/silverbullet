import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/closebrackets";
import { indentWithTab, standardKeymap } from "@codemirror/commands";
import { history, historyKeymap } from "@codemirror/history";
import { indentOnInput } from "@codemirror/language";
import { bracketMatching } from "@codemirror/matchbrackets";
import { searchKeymap } from "@codemirror/search";
import { EditorState, StateField, Transaction } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import React, { useEffect, useReducer, useRef } from "react";
import ReactDOM from "react-dom";
import * as commands from "./commands";
import { HttpFileSystem } from "./fs";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import customMarkDown from "./parser";
import customMarkdownStyle from "./style";

import { FilterList } from "./components/filter";

import { NoteMeta, AppViewState, Action } from "./types";
import reducer from "./reducer";

const fs = new HttpFileSystem("http://localhost:2222/fs");

const initialViewState = {
  currentNote: "",
  isSaved: false,
  isFiltering: false,
  allNotes: [],
};

class Editor {
  view: EditorView;
  currentNote: string;
  dispatch: React.Dispatch<Action>;

  constructor(
    parent: Element,
    currentNote: string,
    text: string,
    dispatch: React.Dispatch<Action>
  ) {
    this.view = new EditorView({
      state: this.createEditorState(text),
      parent: parent,
    });
    this.currentNote = currentNote;
    this.dispatch = dispatch;
  }

  createEditorState(text: string): EditorState {
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
          {
            key: "Ctrl-p",
            mac: "Cmd-p",
            run: (target): boolean => {
              this.dispatch({ type: "start-navigate" });
              return true;
            },
          },
        ]),
        EditorView.domEventHandlers({
          click: this.click.bind(this),
        }),
        markdown({
          base: customMarkDown,
        }),
        StateField.define({
          create: () => null,
          update: this.update.bind(this),
        }),
      ],
    });
  }

  update(value: null, transaction: Transaction): null {
    if (transaction.docChanged) {
      this.dispatch({
        type: "updated",
      });
    }

    return null;
  }

  load(name: string, text: string) {
    this.currentNote = name;
    this.view.setState(this.createEditorState(text));
  }

  click(event: MouseEvent, view: EditorView) {
    if (event.metaKey || event.ctrlKey) {
      console.log("Navigate click");
      let coords = view.posAtCoords(event);
      console.log("Coords", view.state.doc.sliceString(coords!, coords! + 1));
      return false;
    }
  }

  async save() {
    await fs.writeNote(this.currentNote, this.view.state.sliceDoc());
    this.dispatch({ type: "saved" });
  }

  focus() {
    this.view.focus();
  }

  navigate(name: string) {
    location.hash = encodeURIComponent(name);
  }
}

function TopBar({
  currentNote,
  isSaved,
  isFiltering,
  allNotes,
  onNavigate,
  onClick,
}: {
  currentNote: string;
  isSaved: boolean;
  isFiltering: boolean;
  allNotes: NoteMeta[];
  onNavigate: (note: string | undefined) => void;
  onClick: () => void;
}) {
  return (
    <div id="top">
      <div className="current-note" onClick={onClick}>
        » {currentNote}
        {isSaved ? "" : "*"}
      </div>

      {isFiltering && (
        <FilterList
          initialText=""
          options={allNotes}
          onSelect={(opt) => {
            console.log("Selected", opt);
            onNavigate(opt?.name);
          }}
        ></FilterList>
      )}
    </div>
  );
}

let editor: Editor | null;

function AppView() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [appState, dispatch] = useReducer(reducer, initialViewState);

  useEffect(() => {
    editor = new Editor(editorRef.current!, "", "", dispatch);
    editor.focus();
    // @ts-ignore
    window.editor = editor;
    if (!location.hash) {
      editor.navigate("start");
    }
  }, []);

  useEffect(() => {
    fs.listNotes()
      .then((notes) => {
        dispatch({
          type: "notes-list",
          notes: notes,
        });
      })
      .catch((e) => console.error(e));
  }, []);

  useEffect(() => {
    function hashChange() {
      const noteName = decodeURIComponent(location.hash.substring(1));
      console.log("Now navigating to", noteName);

      fs.readNote(noteName)
        .then((text) => {
          editor!.load(noteName, text);
          dispatch({
            type: "loaded",
            name: noteName,
          });
        })
        .catch((e) => {
          console.error("Error loading note", e);
        });
    }
    hashChange();
    window.addEventListener("hashchange", hashChange);
    return () => {
      window.removeEventListener("hashchange", hashChange);
    };
  }, []);

  return (
    <>
      <TopBar
        currentNote={appState.currentNote}
        isSaved={appState.isSaved}
        isFiltering={appState.isFiltering}
        allNotes={appState.allNotes}
        onClick={() => {
          dispatch({ type: "start-navigate" });
        }}
        onNavigate={(note) => {
          dispatch({ type: "stop-navigate" });
          editor!.focus();
          if (note) {
            editor!.navigate(note);
          }
        }}
      />
      <div id="editor" ref={editorRef}></div>
      <div id="bottom">Bottom</div>
    </>
  );
}

ReactDOM.render(<AppView />, document.getElementById("root"));
