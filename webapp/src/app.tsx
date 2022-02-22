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
import { CommandPalette } from "./components/commandpalette";
import { NoteNavigator } from "./components/notenavigator";
import { HttpFileSystem } from "./fs";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import customMarkDown from "./parser";
import reducer from "./reducer";
import customMarkdownStyle from "./style";
import { Action, AppViewState } from "./types";

import { syntaxTree } from "@codemirror/language";
import * as util from "./util";
import { NoteMeta } from "./types";

const fs = new HttpFileSystem("http://localhost:2222/fs");

const initialViewState: AppViewState = {
  currentNote: "",
  isSaved: false,
  showNoteNavigator: false,
  showCommandPalette: false,
  allNotes: [],
};

import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

class Editor {
  view: EditorView;
  currentNote: string;
  dispatch: React.Dispatch<Action>;
  allNotes: NoteMeta[];

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
    this.allNotes = [];
  }

  createEditorState(text: string): EditorState {
    const editor = this;
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
        autocompletion({
          override: [this.noteCompleter.bind(this)],
        }),
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
            key: "Ctrl-Enter",
            mac: "Cmd-Enter",
            run: (target): boolean => {
              // TODO: Factor this and click handler into one action
              let selection = target.state.selection.main;
              if (selection.empty) {
                let node = syntaxTree(target.state).resolveInner(
                  selection.from
                );
                if (node && node.name === "WikiLinkPage") {
                  let noteName = target.state.sliceDoc(node.from, node.to);
                  this.navigate(noteName);
                  return true;
                }
              }
              return false;
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
          {
            key: "Ctrl-.",
            mac: "Cmd-.",
            run: (target): boolean => {
              this.dispatch({ type: "show-palette" });
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

  noteCompleter(ctx: CompletionContext): CompletionResult | null {
    let prefix = ctx.matchBefore(/\[\[\w*/);
    if (!prefix) {
      return null;
    }
    // TODO: Lots of optimization potential here
    // TODO: put something in the cm-completionIcon-note style
    return {
      from: prefix.from + 2,
      options: this.allNotes.map((noteMeta) => ({
        label: noteMeta.name,
        type: "note",
      })),
    };
  }

  update(value: null, transaction: Transaction): null {
    if (transaction.docChanged) {
      this.dispatch({
        type: "note-updated",
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
      let coords = view.posAtCoords(event)!;
      let node = syntaxTree(view.state).resolveInner(coords);
      if (node && node.name === "WikiLinkPage") {
        let noteName = view.state.sliceDoc(node.from, node.to);
        this.navigate(noteName);
      }
      if (node && node.name === "TaskMarker") {
        let checkBoxText = view.state.sliceDoc(node.from, node.to);
        if (checkBoxText === "[x]" || checkBoxText === "[X]") {
          view.dispatch({
            changes: { from: node.from, to: node.to, insert: "[ ]" },
          });
        } else {
          view.dispatch({
            changes: { from: node.from, to: node.to, insert: "[x]" },
          });
        }
      }
      return false;
    }
  }

  async save() {
    const created = await fs.writeNote(
      this.currentNote,
      this.view.state.sliceDoc()
    );
    this.dispatch({ type: "note-saved" });
    // If a new note was created, let's refresh the note list
    if (created) {
      await this.loadNoteList();
    }
  }

  async loadNoteList() {
    let notesMeta = await fs.listNotes();
    this.allNotes = notesMeta;
    this.dispatch({
      type: "notes-listed",
      notes: notesMeta,
    });
  }

  focus() {
    this.view.focus();
  }

  navigate(name: string) {
    location.hash = encodeURIComponent(name);
  }
}

let editor: Editor | null;

function NavigationBar({
  currentNote,
  onClick,
}: {
  currentNote: string;
  onClick: () => void;
}) {
  return (
    <div id="top">
      <div className="current-note" onClick={onClick}>
        » {currentNote}
      </div>
    </div>
  );
}

function StatusBar({ isSaved }: { isSaved: boolean }) {
  let wordCount = 0,
    readingTime = 0;
  if (editor) {
    let text = editor.view.state.sliceDoc();
    wordCount = util.countWords(text);
    readingTime = util.readingTime(wordCount);
  }
  return (
    <div id="bottom">
      {wordCount} words | {readingTime} min | {isSaved ? "Saved" : "Edited"}
    </div>
  );
}

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
    editor?.loadNoteList();
  }, []);

  // Auto save
  useEffect(() => {
    const id = setTimeout(() => {
      if (!appState.isSaved) {
        editor?.save();
      }
    }, 2000);
    return () => {
      clearTimeout(id);
    };
  }, [appState.isSaved]);

  useEffect(() => {
    function hashChange() {
      const noteName = decodeURIComponent(location.hash.substring(1));
      console.log("Now navigating to", noteName);

      fs.readNote(noteName)
        .then((text) => {
          editor!.load(noteName, text);
          dispatch({
            type: "note-loaded",
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
      {appState.showNoteNavigator && (
        <NoteNavigator
          allNotes={appState.allNotes}
          onNavigate={(note) => {
            dispatch({ type: "stop-navigate" });
            editor!.focus();
            if (note) {
              editor
                ?.save()
                .then(() => {
                  editor!.navigate(note);
                })
                .catch((e) => {
                  alert("Could not save note, not switching");
                });
            }
          }}
        />
      )}
      {appState.showCommandPalette && (
        <CommandPalette
          onTrigger={(cmd) => {
            dispatch({ type: "hide-palette" });
            editor!.focus();
            if (cmd) {
              console.log("Run", cmd);
            }
          }}
          commands={[{ name: "My command", run: () => {} }]}
        />
      )}
      <NavigationBar
        currentNote={appState.currentNote}
        onClick={() => {
          dispatch({ type: "start-navigate" });
        }}
      />
      <div id="editor" ref={editorRef}></div>
      <StatusBar isSaved={appState.isSaved} />
    </>
  );
}

ReactDOM.render(<AppView />, document.getElementById("root"));
