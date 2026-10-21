import { autocompletion, completionStatus } from "@codemirror/autocomplete";
import { LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import {
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
} from "@codemirror/view";
import { useEffect, useRef } from "preact/hooks";
import type { Client } from "../../client.ts";
import { luaLanguage } from "../../space_lua/parse.ts";
import { editorHighlightStyle } from "../../style.ts";
import { replCompletionSource } from "./repl_completion.ts";

/**
 * A one-line Space Lua input with the console's completion, for the query
 * builder's Expression filters, columns and sort keys. It starts from
 * `initial` and then owns its text: to show another value, key it anew.
 */
export function LuaLineInput({
  client,
  initial,
  label,
  placeholder,
  autoFocus,
  onChange,
  onEnter,
}: {
  client: Client;
  initial: string;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onEnter?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ onChange, onEnter });
  latest.current = { onChange, onEnter };

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      doc: initial,
      extensions: [
        new LanguageSupport(luaLanguage),
        syntaxHighlighting(editorHighlightStyle()),
        autocompletion({
          override: [
            replCompletionSource(() => client.clientSystem.spaceLuaEnv.env),
          ],
        }),
        Prec.high(
          keymap.of([
            {
              key: "Enter",
              run: (v) => {
                // An open completion list takes Enter first
                if (completionStatus(v.state) === "active") return false;
                latest.current.onEnter?.();
                return true;
              },
            },
          ]),
        ),
        // One line: newlines in pasted text become spaces
        EditorState.transactionFilter.of((tr) =>
          tr.newDoc.lines > 1
            ? [
                tr,
                {
                  changes: {
                    from: 0,
                    to: tr.newDoc.length,
                    insert: tr.newDoc.toString().replace(/\n/g, " "),
                  },
                  sequential: true,
                },
              ]
            : tr,
        ),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onChange(u.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ "aria-label": label }),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      ],
    });
    if (autoFocus) view.focus();
    return () => view.destroy();
  }, [client, label]);

  return <div className="sb-wbq-lua" ref={host} />;
}
