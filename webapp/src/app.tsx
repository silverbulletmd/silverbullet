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
import { FileSystem, HttpFileSystem } from "./fs";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import customMarkDown from "./parser";
import reducer from "./reducer";
import customMarkdownStyle from "./style";
import { Action, AppViewState } from "./types";

import { syntaxTree } from "@codemirror/language";
import * as util from "./util";
import { NoteMeta } from "./types";

const initialViewState: AppViewState = {
  isSaved: false,
  showNoteNavigator: false,
  showCommandPalette: false,
  allNotes: [],
};

import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { NavigationBar } from "./components/navigation_bar";
import { StatusBar } from "./components/status_bar";

class NoteState {
  editorState: EditorState;
  scrollTop: number;

  constructor(editorState: EditorState, scrollTop: number) {
    this.editorState = editorState;
    this.scrollTop = scrollTop;
  }
}

class Editor {
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  $hashChange?: () => void;
  openNotes: Map<string, NoteState>;
  fs: FileSystem;

  constructor(fs: FileSystem, parent: Element) {
    this.fs = fs;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};
    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState(""),
      parent: document.getElementById("editor")!,
    });
    this.addListeners();
    this.loadNoteList();
    this.openNotes = new Map();
    this.$hashChange!();
  }

  get currentNote(): string | undefined {
    return this.viewState.currentNote;
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
              this.viewDispatch({ type: "start-navigate" });
              return true;
            },
          },
          {
            key: "Ctrl-.",
            mac: "Cmd-.",
            run: (target): boolean => {
              this.viewDispatch({ type: "show-palette" });
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
      options: this.viewState.allNotes.map((noteMeta) => ({
        label: noteMeta.name,
        type: "note",
      })),
    };
  }

  update(value: null, transaction: Transaction): null {
    if (transaction.docChanged) {
      this.viewDispatch({
        type: "note-updated",
      });
    }

    return null;
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
    const editorState = this.editorView!.state;

    if (!this.currentNote) {
      return;
    }
    // Write to file system
    const created = await this.fs.writeNote(
      this.currentNote,
      editorState.sliceDoc()
    );

    // Update in open note cache
    this.openNotes.set(
      this.currentNote,
      new NoteState(editorState, this.editorView!.scrollDOM.scrollTop)
    );

    // Dispatch update to view
    this.viewDispatch({ type: "note-saved" });

    // If a new note was created, let's refresh the note list
    if (created) {
      await this.loadNoteList();
    }
  }

  async loadNoteList() {
    let notesMeta = await this.fs.listNotes();
    this.viewDispatch({
      type: "notes-listed",
      notes: notesMeta,
    });
  }

  focus() {
    this.editorView!.focus();
  }

  async navigate(name: string) {
    location.hash = encodeURIComponent(name);
  }

  hashChange() {
    Promise.resolve()
      .then(async () => {
        await this.save();
        const noteName = decodeURIComponent(location.hash.substring(1));
        console.log("Now navigating to", noteName);

        if (!this.editorView) {
          return;
        }

        let noteState = this.openNotes.get(noteName);
        if (!noteState) {
          let text = await this.fs.readNote(noteName);
          noteState = new NoteState(this.createEditorState(text), 0);
        }
        this.openNotes.set(noteName, noteState!);
        this.editorView!.setState(noteState!.editorState);
        this.editorView.scrollDOM.scrollTop = noteState!.scrollTop;

        this.viewDispatch({
          type: "note-loaded",
          name: noteName,
        });
      })
      .catch((e) => {
        console.error(e);
      });
  }

  addListeners() {
    this.$hashChange = this.hashChange.bind(this);
    window.addEventListener("hashchange", this.$hashChange);
  }

  dispose() {
    if (this.$hashChange) {
      window.removeEventListener("hashchange", this.$hashChange);
    }
  }

  ViewComponent(): React.ReactElement {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    useEffect(() => {
      if (!location.hash) {
        this.navigate("start");
      }
    }, []);

    // Auto save
    useEffect(() => {
      const id = setTimeout(() => {
        if (!viewState.isSaved) {
          this.save();
        }
      }, 2000);
      return () => {
        clearTimeout(id);
      };
    }, [viewState.isSaved]);

    let editor = this;

    useEffect(() => {}, []);

    return (
      <>
        {viewState.showNoteNavigator && (
          <NoteNavigator
            allNotes={viewState.allNotes}
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
        {viewState.showCommandPalette && (
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
          currentNote={viewState.currentNote}
          onClick={() => {
            dispatch({ type: "start-navigate" });
          }}
        />
        <div id="editor"></div>
        <StatusBar isSaved={viewState.isSaved} editorView={this.editorView} />
      </>
    );
  }

  render(container: ReactDOM.Container) {
    const ViewComponent = this.ViewComponent.bind(this);
    ReactDOM.render(<ViewComponent />, container);
  }
}

let ed = new Editor(
  new HttpFileSystem("http://localhost:2222/fs"),
  document.getElementById("root")!
);

ed.focus();

// @ts-ignore
window.editor = ed;
