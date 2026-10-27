import {
  autocompletion,
  closeBrackets,
  closeCompletion,
  closeBracketsKeymap,
  completionStatus,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  historyKeymap,
  insertNewlineAndIndent,
  history as undoHistory,
} from "@codemirror/commands";
import { LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "preact/hooks";
import { isMacLike } from "../../../plug-api/lib/shortcut.ts";
import type { Client } from "../../client.ts";
import type { FocusTarget } from "../../navigator/ui/native_views.ts";
import { luaLanguage } from "../../space_lua/parse.ts";
import { editorHighlightStyle } from "../../style.ts";
import { replCompletionSource } from "../shared/repl_completion.ts";
import {
  type ConsoleContext,
  type ConsoleSession,
  isIncompleteInput,
} from "./console_session.ts";
import { historyKey, historyStore, InputHistory } from "./history.ts";
import { replCommandBindings } from "./repl_keys.ts";

export function ReplInput({
  client,
  session,
  focusTarget,
  context,
  pageName,
}: {
  client: Client;
  session: ConsoleSession;
  context: ConsoleContext;
  pageName: string;
  /** Receives the editor's content element, which takes focus when the panel does. */
  focusTarget: FocusTarget;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const commandKeys = useRef(new Compartment()).current;
  const commands = client.ui.viewState.commands;

  useEffect(() => {
    if (!host.current) return;
    const history = new InputHistory(
      historyKey(document.baseURI),
      historyStore(!!client.bootConfig.enableClientEncryption),
    );

    const setDoc = (view: EditorView, text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
    };

    const replKeymap = keymap.of([
      {
        key: "Enter",
        run: (view) => {
          // Returning false lets the completion keymap accept the selection
          if (completionStatus(view.state) === "active") return false;
          const code = view.state.doc.toString();
          if (isIncompleteInput(code)) return insertNewlineAndIndent(view);
          if (!code.trim()) return true;
          void session.run(code);
          history.push(code);
          setDoc(view, "");
          return true;
        },
      },
      { key: "Shift-Enter", run: insertNewlineAndIndent },
      {
        key: "ArrowUp",
        run: (view) => {
          if (completionStatus(view.state) === "active") return false;
          const { state } = view;
          if (state.doc.lineAt(state.selection.main.head).number !== 1) {
            return false;
          }
          const text = history.prev(state.doc.toString());
          if (text === null) return false;
          setDoc(view, text);
          return true;
        },
      },
      {
        key: "ArrowDown",
        run: (view) => {
          if (completionStatus(view.state) === "active") return false;
          const { state } = view;
          if (
            state.doc.lineAt(state.selection.main.head).number !==
            state.doc.lines
          ) {
            return false;
          }
          const text = history.next();
          if (text === null) return false;
          setDoc(view, text);
          return true;
        },
      },
    ]);

    const view = new EditorView({
      parent: host.current,
      extensions: [
        new LanguageSupport(luaLanguage),
        syntaxHighlighting(editorHighlightStyle()),
        undoHistory(),
        closeBrackets(),
        // autocompletion() installs its keymap at highest precedence, so an open list takes Enter and arrows first
        autocompletion({
          override: [replCompletionSource(() => session.completionEnv())],
        }),
        Prec.high(replKeymap),
        // App shortcuts outrank the default editing keymap (Mod-/ opens the palette, not toggles a comment)
        commandKeys.of(commandKeymap(client)),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Space Lua console input",
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [client, session]);

  useEffect(() => {
    if (viewRef.current) closeCompletion(viewRef.current);
  }, [context, pageName]);

  // Its own effect: switching tabs swaps `focusTarget` without recreating the editor
  useEffect(() => {
    const el = viewRef.current?.contentDOM;
    return el ? focusTarget(el) : undefined;
  }, [focusTarget]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: commandKeys.reconfigure(commandKeymap(client)),
    });
  }, [client, commands]);

  return (
    <div className="sb-workbench-input">
      <span className="sb-wb-prompt">›</span>
      <div className="sb-wb-repl" ref={host} />
    </div>
  );
}

function commandKeymap(client: Client) {
  return keymap.of(
    replCommandBindings(client.ui.viewState.commands.values(), {
      isMac: isMacLike,
      readOnly:
        client.bootConfig.readOnly ||
        client.ui.viewState.uiOptions.forcedROMode,
      run: (cmd) => {
        void Promise.resolve()
          .then(() => cmd.run?.())
          .catch((e) => client.reportError(e, "key"));
      },
    }),
  );
}
