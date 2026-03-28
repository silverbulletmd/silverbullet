import customMarkdownStyle from "../style.ts";
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
  foldEffect,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
  unfoldEffect,
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
import { markdown } from "@codemirror/lang-markdown";
import type { Client } from "../client.ts";
import { loadVim } from "../vim_loader.ts";
import { inlineContentPlugin } from "./inline_content.ts";
import { cleanModePlugins } from "./clean.ts";
import { lineWrapper } from "./line_wrapper.ts";
import { createSmartQuoteKeyBindings } from "./smart_quotes.ts";
import { documentExtension, pasteLinkExtension } from "./editor_paste.ts";
import type { TextChange } from "./change.ts";
import { postScriptPrefacePlugin } from "./top_bottom_panels.ts";
import {
  lazyLanguages,
  languageFor,
  loadLanguageFor,
} from "../languages.ts";
import { plugLinter } from "./lint.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { safeRun } from "@silverbulletmd/silverbullet/lib/async";
import { codeCopyPlugin } from "../codemirror/code_copy.ts";
import { disableSpellcheck } from "../codemirror/spell_checking.ts";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";

export function createEditorState(
  client: Client,
  pageName: string,
  text: string,
  readOnly: boolean,
): EditorState {
  let touchCount = 0;

  // Ugly: keep the commandKeyHandler compartment in the client, to be replaced
  // later once more commands are loaded
  client.commandKeyHandlerCompartment = new Compartment();
  client.vimCompartment = new Compartment();
  const commandKeyBindings = client.commandKeyHandlerCompartment.of(
    createCommandKeyBindings(client),
  );
  // Regular key bindings are not dynamically updated and do not require a
  // compartment.
  const regularKeyBindings = createRegularKeyBindings(client);

  client.indentUnitCompartment = new Compartment();
  const indentUnits = client.indentUnitCompartment.of(indentUnit.of("  "));

  client.undoHistoryCompartment = new Compartment();
  const undoHistory = client.undoHistoryCompartment.of([history()]);

  // Build the markdown language with any custom syntax extensions
  client.markdownLanguageCompartment = new Compartment();
  const markdownLanguageExtension = client.markdownLanguageCompartment.of(
    buildMarkdownLanguageExtension(client),
  );

  const vimMode = client.ui.viewState.uiOptions.vimMode;

  // If vim mode is requested, load it async and reconfigure the compartment
  if (vimMode) {
    void enableVimMode(client);
  }

  const readOnlyExtensions: Extension[] =
    readOnly ||
    client.ui.viewState.uiOptions.forcedROMode ||
    client.bootConfig.readOnly
      ? [EditorView.editable.of(false), EditorState.readOnly.of(true)]
      : [];

  return EditorState.create({
    doc: text,
    extensions: [
      // Not using CM theming right now, but some extensions depend on the "dark" thing
      EditorView.theme(
        {},
        {
          dark: client.ui.viewState.uiOptions.darkMode,
        },
      ),

      // Insert our command key bindings *before* vim mode. Vim in normal-mode is
      // greedy and captures all key events, preventing them from reaching our
      // own handlers to trigger commands. This will mean some vim-mode
      // bindings wont trigger if they have the same keys.
      commandKeyBindings,

      // Vim mode compartment — starts empty, loaded async if needed
      client.vimCompartment.of([]),
      readOnlyExtensions,

      // The uber markdown mode (in a compartment so it can be reconfigured on reload)
      markdownLanguageExtension,
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
            return `sb-decorated-object ${completion.cssClass}`;
          } else {
            return "";
          }
        },
      }),
      EditorView.contentAttributes.of({
        spellcheck: "true",
        autocorrect: "on",
        autocapitalize: "on",
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
      regularKeyBindings,
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
          // Track file changed during an IME composition session
          private composingDirty = false;

          update(update: ViewUpdate): void {
            if (update.transactions.length > 0) {
              for (const tr of update.transactions) {
                for (const e of tr.effects) {
                  if (e.is(foldEffect)) {
                    void client.dispatchAppEvent("editor:fold", e.value);
                  }
                  if (e.is(unfoldEffect)) {
                    void client.dispatchAppEvent("editor:unfold", e.value);
                  }
                }
              }
            }
            if (update.docChanged) {
              // Find if there's a history isolate in the transaction, if so it came from a local reload and we don't do anything
              if (
                update.transactions.some((t) => t.annotation(isolateHistory))
              ) {
                return;
              }

              // Defer save and event dispatch during IME composition
              if (update.view.composing) {
                // Mark dirty so we flush when composition ends
                this.composingDirty = true;
                client.ui.viewDispatch({ type: "page-changed" });
                return;
              }

              const changes: TextChange[] = [];
              update.changes.iterChanges((fromA, toA, fromB, toB, inserted) =>
                changes.push({
                  inserted: inserted.toString(),
                  oldRange: { from: fromA, to: toA },
                  newRange: { from: fromB, to: toB },
                }),
              );
              void client.dispatchAppEvent("editor:pageModified", { changes });
              client.ui.viewDispatch({ type: "page-changed" });
              client.contentManager.debouncedUpdateEvent();
              client.save().catch((e) => console.error("Error saving", e));
              this.composingDirty = false;
            } else if (this.composingDirty && !update.view.composing) {
              // Flush now because composition ended without file changes
              this.composingDirty = false;
              client.contentManager.debouncedUpdateEvent();
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
  return (
    requiredEditor === undefined ||
    (currentEditor === undefined && requiredEditor === "page") ||
    requiredEditor === "any" ||
    currentEditor === requiredEditor ||
    (currentEditor !== undefined && requiredEditor === "notpage")
  );
}

export function createCommandKeyBindings(client: Client): Extension {
  const commandKeyBindings: KeyBinding[] = [];

  // Then add bindings for plug commands
  for (const def of client.clientSystem.commandHook
    .buildAllCommands()
    .values()) {
    const currentEditor = client.contentManager.documentEditor?.name;
    const requiredEditor = def.requireEditor;

    if ((def.key || def.mac) && isValidEditor(currentEditor, requiredEditor)) {
      const run = (): boolean => {
        if (def.contexts) {
          const context = client.getContext();
          if (!context || !def.contexts.includes(context)) {
            return false;
          }
        }
        void Promise.resolve([])
          .then(def.run)
          .catch((e: any) => {
            client.reportError(e, "key");
          })
          .then((returnValue: any) => {
            // Always be focusing the editor after running a command UNLESS it returns false
            if (returnValue !== false) {
              client.focus();
            }
          });

        return true;
      };
      // Only create a generic key handler (non-mac specific) when
      // EITHER we're not on a mac, or we're on a mac AND not specific mac key binding is set
      if (def.key && (!isMacLike || (isMacLike && !def.mac))) {
        if (Array.isArray(def.key)) {
          for (const key of def.key) {
            commandKeyBindings.push({ key, run });
          }
        } else {
          commandKeyBindings.push({ key: def.key, run });
        }
      }
      // Only set mac key handlers if we're on a mac, because... you know, logic
      if (def.mac && isMacLike) {
        if (Array.isArray(def.mac)) {
          for (const key of def.mac) {
            commandKeyBindings.push({ mac: key, run });
          }
        } else {
          commandKeyBindings.push({ mac: def.mac, run });
        }
      }
    }
  }

  return keymap.of([...commandKeyBindings]);
}

export function createRegularKeyBindings(client: Client): Extension {
  if (client.contentManager.isDocumentEditor()) {
    return keymap.of([]);
  } else {
    return keymap.of([
      ...createSmartQuoteKeyBindings(client),
      ...closeBracketsKeymap,
      ...(client.ui.viewState.uiOptions.vimMode
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
        : standardKeymap),
      ...completionKeymap,
      { key: "Tab", run: acceptCompletion },
      indentWithTab,
    ]);
  }
}

async function enableVimMode(client: Client) {
  const { vim } = await loadVim();
  if (client.editorView && client.vimCompartment) {
    client.editorView.dispatch({
      effects: client.vimCompartment.reconfigure([
        vim({ status: true }),
        EditorState.allowMultipleSelections.of(true),
      ]),
    });
  }
}

/**
 * Checks if the current platform is Mac-like (Mac, iPhone, iPod, iPad).
 * @returns A boolean indicating if the platform is Mac-like.
 */
export const isMacLike = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);

export function buildMarkdownLanguageExtension(client: Client): Extension[] {
  const syntaxExtensions = client.config.get("syntaxExtensions", {});
  const markdownLanguage = buildExtendedMarkdownLanguage(syntaxExtensions);
  return [
    markdown({
      base: markdownLanguage,
      codeLanguages: (info) => {
        const lang = languageFor(info);
        if (lang) {
          return LanguageDescription.of({
            name: info,
            support: new LanguageSupport(lang),
          });
        }
        if (info in lazyLanguages) {
          return LanguageDescription.of({
            name: info,
            load: async () =>
              new LanguageSupport((await loadLanguageFor(info))!),
          });
        }
        return null;
      },
      addKeymap: true,
    }),
    markdownLanguage.data.of({
      closeBrackets: {
        brackets: client.config
          .get<string | undefined>("autoCloseBrackets", undefined)
          ?.split(""),
      },
    }),
  ];
}
