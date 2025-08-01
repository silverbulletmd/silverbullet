import customMarkdownStyle from "./style.ts";
import {
  history,
  indentWithTab,
  insertNewlineAndIndent,
  isolateHistory,
  standardKeymap,
} from "@codemirror/commands";
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  codeFolding,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  type KeyBinding,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { markdown } from "@codemirror/lang-markdown";
import type { Client } from "./client.ts";
import { inlineContentPlugin } from "./cm_plugins/inline_content.ts";
import { cleanModePlugins } from "./cm_plugins/clean.ts";
import { lineWrapper } from "./cm_plugins/line_wrapper.ts";
import { createSmartQuoteKeyBindings } from "./cm_plugins/smart_quotes.ts";
import {
  documentExtension,
  pasteLinkExtension,
} from "./cm_plugins/editor_paste.ts";
import type { TextChange } from "./change.ts";
import { postScriptPrefacePlugin } from "./cm_plugins/top_bottom_panels.ts";
import { languageFor } from "./languages.ts";
import { plugLinter } from "./cm_plugins/lint.ts";
import { extendedMarkdownLanguage } from "./markdown_parser/parser.ts";
import { safeRun } from "../lib/async.ts";
import { codeCopyPlugin } from "./cm_plugins/code_copy.ts";
import { disableSpellcheck } from "./cm_plugins/spell_checking.ts";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";

export function createEditorState(
  client: Client,
  pageName: string,
  text: string,
  readOnly: boolean,
): EditorState {
  let touchCount = 0;

  // Ugly: keep the keyhandler compartment in the client, to be replaced later once more commands are loaded
  client.keyHandlerCompartment = new Compartment();
  const keyBindings = client.keyHandlerCompartment.of(
    createKeyBindings(client),
  );

  client.indentUnitCompartment = new Compartment();
  const indentUnits = client.indentUnitCompartment.of(
    indentUnit.of("  "),
  );

  client.undoHistoryCompartment = new Compartment();
  const undoHistory = client.undoHistoryCompartment.of([history()]);

  return EditorState.create({
    doc: text,
    extensions: [
      // Not using CM theming right now, but some extensions depend on the "dark" thing
      EditorView.theme({}, {
        dark: client.ui.viewState.uiOptions.darkMode,
      }),

      // Enable vim mode, or not
      [
        ...client.ui.viewState.uiOptions.vimMode
          ? [
            vim({ status: true }),
            EditorState.allowMultipleSelections.of(true),
          ]
          : [],
      ],
      [
        ...(readOnly || client.ui.viewState.uiOptions.forcedROMode)
          ? [EditorView.editable.of(false)]
          : [],
      ],

      // The uber markdown mode
      markdown({
        base: extendedMarkdownLanguage,
        codeLanguages: (info) => {
          const lang = languageFor(info);
          if (lang) {
            return LanguageDescription.of({
              name: info,
              support: new LanguageSupport(lang),
            });
          }

          return null;
        },
        addKeymap: true,
      }),
      extendedMarkdownLanguage.data.of({
        closeBrackets: {
          brackets: client.config.get<string | undefined>(
            "autoCloseBrackets",
            undefined,
          )?.split(
            "",
          ),
        },
      }),
      syntaxHighlighting(customMarkdownStyle()),
      autocompletion({
        override: [
          client.editorComplete.bind(client),
          client.clientSystem.slashCommandHook!.slashCommandCompleter.bind(
            client.clientSystem.slashCommandHook,
          ),
        ],
        optionClass(completion: any) {
          if (completion.cssClass) {
            return "sb-decorated-object " + completion.cssClass;
          } else {
            return "";
          }
        },
      }),
      inlineContentPlugin(client),
      codeCopyPlugin(client),
      highlightSpecialChars(),
      undoHistory,
      dropCursor(),
      codeFolding({
        placeholderText: "…",
      }),
      indentUnits,
      indentOnInput(),
      ...cleanModePlugins(client),
      EditorView.lineWrapping,
      plugLinter(client),
      drawSelection(),
      postScriptPrefacePlugin(client),
      lineWrapper([
        { selector: "ATXHeading1", class: "sb-line-h1" },
        { selector: "ATXHeading2", class: "sb-line-h2" },
        { selector: "ATXHeading3", class: "sb-line-h3" },
        { selector: "ATXHeading4", class: "sb-line-h4" },
        { selector: "ATXHeading5", class: "sb-line-h5" },
        { selector: "ATXHeading6", class: "sb-line-h6" },
        { selector: "ListItem", class: "sb-line-li", nesting: true },
        { selector: "Blockquote", class: "sb-line-blockquote" },
        { selector: "Task", class: "sb-line-task" },
        { selector: "CodeBlock", class: "sb-line-code" },
        { selector: "FencedCode", class: "sb-line-fenced-code" },
        { selector: "Comment", class: "sb-line-comment" },
        { selector: "BulletList", class: "sb-line-ul" },
        { selector: "OrderedList", class: "sb-line-ol" },
        { selector: "TableHeader", class: "sb-line-tbl-header" },
        {
          selector: "FrontMatter",
          class: "sb-frontmatter",
        },
      ]),
      disableSpellcheck(["InlineCode", "CodeText", "CodeInfo", "FrontMatter"]),
      keyBindings,
      EditorView.domEventHandlers({
        // This may result in duplicated touch events on mobile devices
        touchmove: () => {
          touchCount++;
        },
        touchend: (event: TouchEvent, view: EditorView) => {
          if (touchCount === 0) {
            safeRun(async () => {
              const touch = event.changedTouches.item(0)!;
              if (!event.altKey && event.target instanceof Element) {
                // prevent the browser from opening the link twice
                const parentA = event.target.closest("a");
                if (parentA) {
                  event.preventDefault();
                }
              }

              const pos = view.posAtCoords({
                x: touch.clientX,
                y: touch.clientY,
              })!;

              const potentialClickEvent: ClickEvent = {
                page: pageName,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                pos: pos,
              };

              const distanceX = touch.clientX - view.coordsAtPos(pos)!.left;
              // What we're trying to determine here is if the tap occured anywhere near the looked up position
              // this may not be the case with locations that expand signifcantly based on live preview (such as links), we don't want any accidental clicks
              // Fixes #585
              //
              if (distanceX <= view.defaultCharacterWidth) {
                await client.dispatchAppEvent(
                  "page:click",
                  potentialClickEvent,
                );
              }
            });
          }
          touchCount = 0;
        },

        click: (event: MouseEvent, view: EditorView) => {
          const pos = view.posAtCoords(event);
          if (event.button !== 0) {
            return;
          }
          if (!pos) {
            return;
          }
          safeRun(async () => {
            const potentialClickEvent: ClickEvent = {
              page: pageName,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              pos: view.posAtCoords({
                x: event.x,
                y: event.y,
              })!,
            };
            // Make sure <a> tags are clicked without moving the cursor there
            if (!event.altKey && event.target instanceof Element) {
              const parentA = event.target.closest("a");
              if (parentA) {
                event.stopPropagation();
                event.preventDefault();
                await client.dispatchAppEvent(
                  "page:click",
                  potentialClickEvent,
                );
                return;
              }
            }

            const distanceX = event.x - view.coordsAtPos(pos)!.left;
            // What we're trying to determine here is if the click occured anywhere near the looked up position
            // this may not be the case with locations that expand signifcantly based on live preview (such as links), we don't want any accidental clicks
            // Fixes #357
            if (distanceX <= view.defaultCharacterWidth) {
              await client.dispatchClickEvent(potentialClickEvent);
            }
          });
        },
      }),
      ViewPlugin.fromClass(
        class {
          update(update: ViewUpdate): void {
            if (update.docChanged) {
              // Find if there's a history isolate in the transaction, if so it came from a local reload and we don't do anything
              if (
                update.transactions.some((t) => t.annotation(isolateHistory))
              ) {
                return;
              }
              const changes: TextChange[] = [];
              update.changes.iterChanges((fromA, toA, fromB, toB, inserted) =>
                changes.push({
                  inserted: inserted.toString(),
                  oldRange: { from: fromA, to: toA },
                  newRange: { from: fromB, to: toB },
                })
              );
              client.dispatchAppEvent("editor:pageModified", { changes });
              client.ui.viewDispatch({ type: "page-changed" });
              client.debouncedUpdateEvent();
              client.save().catch((e) => console.error("Error saving", e));
            }
          }
        },
      ),
      pasteLinkExtension,
      documentExtension(client),
      closeBrackets(),
    ],
  });
}

// TODO: Move this elsewhere
export function isValidEditor(
  currentEditor: string | undefined,
  requiredEditor: string | undefined,
): boolean {
  return (requiredEditor === undefined) ||
    (currentEditor === undefined &&
      requiredEditor === "page") ||
    (requiredEditor === "any") ||
    (currentEditor === requiredEditor) ||
    (currentEditor !== undefined && requiredEditor === "notpage");
}

export function createCommandKeyBindings(client: Client): KeyBinding[] {
  const commandKeyBindings: KeyBinding[] = [];

  // Then add bindings for plug commands
  for (
    const def of client.clientSystem.commandHook.buildAllCommands().values()
  ) {
    const currentEditor = client.documentEditor?.name;
    const requiredEditor = def.requireEditor;

    if (def.key && isValidEditor(currentEditor, requiredEditor)) {
      commandKeyBindings.push({
        key: def.key,
        mac: def.mac,
        run: (): boolean => {
          if (def.contexts) {
            const context = client.getContext();
            if (!context || !def.contexts.includes(context)) {
              return false;
            }
          }
          Promise.resolve([])
            .then(def.run)
            .catch((e: any) => {
              console.error(e);
              client.flashNotification(
                `Error running command: ${e.message}`,
                "error",
              );
            }).then((returnValue: any) => {
              // Always be focusing the editor after running a command
              if (returnValue !== false) {
                client.focus();
              }
            });

          return true;
        },
      });
    }
  }

  return commandKeyBindings;
}

export function createKeyBindings(client: Client): Extension {
  if (client.isDocumentEditor()) {
    return keymap.of([
      ...createCommandKeyBindings(client),
    ]);
  } else {
    return keymap.of([
      ...createCommandKeyBindings(client),
      ...createSmartQuoteKeyBindings(client),
      ...closeBracketsKeymap,
      ...client.ui.viewState.uiOptions.vimMode
        ? [
          // Workaround for https://github.com/replit/codemirror-vim/issues/182;
          // without this, Enter does nothing for ordinary paragraphs in insert
          // mode.
          {
            key: "Enter",
            run: insertNewlineAndIndent,
            shift: insertNewlineAndIndent,
          },
        ]
        : standardKeymap,
      ...completionKeymap,
      { key: "Tab", run: acceptCompletion },
      indentWithTab,
    ]);
  }
}
