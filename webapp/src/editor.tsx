import {
  autocompletion,
  Completion,
  CompletionContext,
  completionKeymap,
  CompletionResult,
} from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/closebrackets";
import { indentWithTab, standardKeymap } from "@codemirror/commands";
import { history, historyKeymap } from "@codemirror/history";
import { indentOnInput, syntaxTree } from "@codemirror/language";
import { bracketMatching } from "@codemirror/matchbrackets";
import { searchKeymap } from "@codemirror/search";
import { EditorState, StateField, Transaction } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  KeyBinding,
  keymap,
} from "@codemirror/view";
import React, { useEffect, useReducer } from "react";
import ReactDOM from "react-dom";
import coreManifest from "../../plugins/dist/core.plugin.json";
import { buildContext } from "./buildContext";
import * as commands from "./commands";
import { CommandPalette } from "./components/command_palette";
import { NavigationBar } from "./components/navigation_bar";
import { NuggetNavigator } from "./components/nugget_navigator";
import { StatusBar } from "./components/status_bar";
import { FileSystem } from "./fs";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import customMarkDown from "./parser";
import { BrowserSystem } from "./plugins/browser_system";
import { Manifest, slashCommandRegexp } from "./plugins/types";
import reducer from "./reducer";
import customMarkdownStyle from "./style";
import dbSyscalls from "./syscalls/db.localstorage";
import editorSyscalls from "./syscalls/editor.browser";
import {
  Action,
  AppCommand,
  AppViewState,
  CommandContext,
  initialViewState,
  NuggetMeta,
} from "./types";
import { safeRun } from "./util";

class NuggetState {
  editorState: EditorState;
  scrollTop: number;
  meta: NuggetMeta;

  constructor(editorState: EditorState, scrollTop: number, meta: NuggetMeta) {
    this.editorState = editorState;
    this.scrollTop = scrollTop;
    this.meta = meta;
  }
}

const watchInterval = 5000;

export class Editor {
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  $hashChange?: () => void;
  openNuggets: Map<string, NuggetState>;
  fs: FileSystem;
  editorCommands: Map<string, AppCommand>;

  constructor(fs: FileSystem, parent: Element) {
    this.editorCommands = new Map();
    this.openNuggets = new Map();
    this.fs = fs;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};
    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState(""),
      parent: document.getElementById("editor")!,
    });
    this.addListeners();
    this.watch();
  }

  async init() {
    await this.loadNuggetList();
    await this.loadPlugins();
    this.$hashChange!();
    this.focus();
  }

  async loadPlugins() {
    const system = new BrowserSystem("plugin");
    system.registerSyscalls(dbSyscalls, editorSyscalls(this));

    await system.bootServiceWorker();
    console.log("Now loading core plugin");
    let mainPlugin = await system.load("core", coreManifest as Manifest);
    this.editorCommands = new Map<string, AppCommand>();
    const cmds = mainPlugin.manifest!.commands;
    for (let name in cmds) {
      let cmd = cmds[name];
      this.editorCommands.set(name, {
        command: cmd,
        run: async (arg: CommandContext): Promise<any> => {
          return await mainPlugin.invoke(cmd.invoke, [arg]);
        },
      });
    }
    this.viewDispatch({
      type: "update-commands",
      commands: this.editorCommands,
    });
  }

  get currentNugget(): NuggetMeta | undefined {
    return this.viewState.currentNugget;
  }

  createEditorState(text: string): EditorState {
    const editor = this;
    let commandKeyBindings: KeyBinding[] = [];
    for (let def of this.editorCommands.values()) {
      if (def.command.key) {
        commandKeyBindings.push({
          key: def.command.key,
          mac: def.command.mac,
          run: (): boolean => {
            Promise.resolve()
              .then(async () => {
                await def.run(buildContext(def, this));
              })
              .catch((e) => console.error(e));
            return true;
          },
        });
      }
    }
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
          override: [
            this.nuggetCompleter.bind(this),
            this.commandCompleter.bind(this),
          ],
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
          ...commandKeyBindings,
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
            key: "Ctrl-e",
            mac: "Cmd-e",
            run: (): boolean => {
              window.open(location.href, "_blank")!.focus();
              return true;
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
              this.viewDispatch({
                type: "show-palette",
              });
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

  nuggetCompleter(ctx: CompletionContext): CompletionResult | null {
    let prefix = ctx.matchBefore(/\[\[[\w\s]*/);
    if (!prefix) {
      return null;
    }
    return {
      from: prefix.from + 2,
      options: this.viewState.allNuggets.map((nuggetMeta) => ({
        label: nuggetMeta.name,
        type: "nugget",
      })),
    };
  }

  commandCompleter(ctx: CompletionContext): CompletionResult | null {
    let prefix = ctx.matchBefore(slashCommandRegexp);
    if (!prefix) {
      return null;
    }
    let options: Completion[] = [];
    for (let [name, def] of this.viewState.commands) {
      if (!def.command.slashCommand) {
        continue;
      }
      options.push({
        label: def.command.slashCommand,
        detail: name,
        apply: () => {
          this.editorView?.dispatch({
            changes: {
              from: prefix!.from,
              to: ctx.pos,
              insert: "",
            },
          });
          safeRun(async () => {
            def.run(buildContext(def, this));
          });
        },
      });
    }
    return {
      from: prefix.from + 1,
      options: options,
    };
  }

  update(value: null, transaction: Transaction): null {
    if (transaction.docChanged) {
      this.viewDispatch({
        type: "nugget-updated",
      });
    }

    return null;
  }

  click(event: MouseEvent, view: EditorView) {
    if (event.metaKey || event.ctrlKey) {
      let coords = view.posAtCoords(event)!;
      let node = syntaxTree(view.state).resolveInner(coords);
      if (node && node.name === "WikiLinkPage") {
        let nuggetName = view.state.sliceDoc(node.from, node.to);
        this.navigate(nuggetName);
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

    if (!this.currentNugget) {
      return;
    }
    // Write to file system
    let nuggetMeta = await this.fs.writeNugget(
      this.currentNugget.name,
      editorState.sliceDoc()
    );

    // Update in open nugget cache
    this.openNuggets.set(
      this.currentNugget.name,
      new NuggetState(
        editorState,
        this.editorView!.scrollDOM.scrollTop,
        nuggetMeta
      )
    );

    // Dispatch update to view
    this.viewDispatch({ type: "nugget-saved", meta: nuggetMeta });

    // If a new nugget was created, let's refresh the nugget list
    if (nuggetMeta.created) {
      await this.loadNuggetList();
    }
  }

  async loadNuggetList() {
    let nuggetsMeta = await this.fs.listNuggets();
    this.viewDispatch({
      type: "nuggets-listed",
      nuggets: nuggetsMeta,
    });
  }

  watch() {
    setInterval(() => {
      safeRun(async () => {
        if (!this.currentNugget) {
          return;
        }
        const currentNuggetName = this.currentNugget.name;
        let newNuggetMeta = await this.fs.getMeta(currentNuggetName);
        if (
          this.currentNugget.lastModified.getTime() <
          newNuggetMeta.lastModified.getTime()
        ) {
          console.log("File changed on disk, reloading");
          let nuggetData = await this.fs.readNugget(currentNuggetName);
          this.openNuggets.set(
            newNuggetMeta.name,
            new NuggetState(
              this.createEditorState(nuggetData.text),
              0,
              newNuggetMeta
            )
          );
          await this.loadNugget(currentNuggetName);
        }
      });
    }, watchInterval);
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
        const nuggetName = decodeURIComponent(location.hash.substring(1));
        console.log("Now navigating to", nuggetName);

        if (!this.editorView) {
          return;
        }

        await this.loadNugget(nuggetName);
      })
      .catch((e) => {
        console.error(e);
      });
  }

  async loadNugget(nuggetName: string) {
    let nuggetState = this.openNuggets.get(nuggetName);
    if (!nuggetState) {
      let nuggetData = await this.fs.readNugget(nuggetName);
      nuggetState = new NuggetState(
        this.createEditorState(nuggetData.text),
        0,
        nuggetData.meta
      );
      this.openNuggets.set(nuggetName, nuggetState!);
    }
    this.editorView!.setState(nuggetState!.editorState);
    this.editorView!.scrollDOM.scrollTop = nuggetState!.scrollTop;

    this.viewDispatch({
      type: "nugget-loaded",
      meta: nuggetState.meta,
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

    useEffect(() => {
      if (viewState.currentNugget) {
        document.title = viewState.currentNugget.name;
      }
    }, [viewState.currentNugget]);

    return (
      <>
        {viewState.showNuggetNavigator && (
          <NuggetNavigator
            allNuggets={viewState.allNuggets}
            onNavigate={(nugget) => {
              dispatch({ type: "stop-navigate" });
              editor!.focus();
              if (nugget) {
                editor
                  ?.save()
                  .then(() => {
                    editor!.navigate(nugget);
                  })
                  .catch((e) => {
                    alert("Could not save nugget, not switching");
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
                safeRun(async () => {
                  let result = await cmd.run(buildContext(cmd, editor));
                  console.log("Result of command", result);
                });
              }
            }}
            commands={viewState.commands}
          />
        )}
        <NavigationBar
          currentNugget={viewState.currentNugget}
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
