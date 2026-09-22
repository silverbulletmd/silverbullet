import {
  autocompletion,
  type Completion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { deleteMarkupBackward, markdown } from "@codemirror/lang-markdown";
import {
  codeFolding,
  foldEffect,
  forceParsing,
  indentOnInput,
  indentUnit,
  type Language,
  LanguageDescription,
  LanguageSupport,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  type EditorSelection,
  EditorState,
  type Extension,
  Prec,
} from "@codemirror/state";
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
import { safeRun } from "@silverbulletmd/silverbullet/lib/async";
import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import type { Client } from "../client.ts";
import { codeCopyPlugin } from "../codemirror/code_copy.ts";
import { disableSpellcheck } from "../codemirror/spell_checking.ts";
import { languageFor, lazyLanguages, loadLanguageFor } from "../languages.ts";
import { isValidEditor } from "../lib/command_filters.ts";
import { createIconElement } from "../lib/icon.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { editorHighlightStyle } from "../style.ts";
import { loadVim } from "../vim_loader.ts";
import type { TextChange } from "./change.ts";
import { cleanModePlugins } from "./clean.ts";
import { conflictMarkers } from "./conflict_markers.ts";
import { documentExtension, pasteLinkExtension } from "./editor_paste.ts";
import { externalPresence } from "./external_presence.ts";
import {
  frontmatterFoldingExtension,
  frontmatterFoldPlaceholderDOM,
  prepareFrontmatterFoldPlaceholder,
} from "./frontmatter_folding.ts";
import { inlineContentPlugin } from "./inline_content.ts";
import { lineWrapper } from "./line_wrapper.ts";
import { plugLinter } from "./lint.ts";
import { customEnterCommand } from "./markdown_enter.ts";
import { createSmartQuoteKeyBindings } from "./smart_quotes.ts";
import { postScriptPrefacePlugin } from "./top_bottom_panels.ts";
import { readOnlyCursorActive } from "./util.ts";

export type EditorMode =
  | { kind: "page"; pageName: string }
  | { kind: "text-document"; path: Path; language: Language | null };

type DecoratedCompletion = Completion & { icon?: unknown };

// Annotation marking a transaction whose changes came from outside the
// editor's edit stream (e.g. a page re-fetch from storage), so the
// save-on-change handler can skip it and avoid an immediate re-save loop.
export const externalUpdate = Annotation.define<boolean>();

export function createEditorState(
  client: Client,
  mode: EditorMode,
  text: string,
  readOnly: boolean,
  selection?: EditorSelection,
): EditorState {
  return EditorState.create({
    doc: text,
    selection,
    extensions: [
      buildSharedEditorExtensions(client, mode, readOnly),
      mode.kind === "page"
        ? buildPageExtensions(client, mode.pageName)
        : buildTextDocumentExtensions(mode.language),
    ],
  });
}

export function createInactiveEditorState(
  client: Client,
  sourceState: EditorState,
  documentReadOnly = client.currentPageMeta()?.perm === "ro",
): EditorState {
  client.commandKeyHandlerCompartment = new Compartment();
  return EditorState.create({
    doc: sourceState.doc,
    selection: sourceState.selection,
    extensions: [
      client.commandKeyHandlerCompartment.of(
        createCommandKeyBindings(client, null, documentReadOnly),
      ),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  });
}

export function buildSharedEditorExtensions(
  client: Client,
  mode: EditorMode,
  readOnly: boolean,
): Extension[] {
  client.commandKeyHandlerCompartment = new Compartment();
  client.vimCompartment = new Compartment();
  const commandKeyBindings = client.commandKeyHandlerCompartment.of(
    createCommandKeyBindings(client, mode, readOnly),
  );
  const regularKeyBindings = createRegularKeyBindings(client, mode);

  client.indentUnitCompartment = new Compartment();
  const indentUnits = client.indentUnitCompartment.of(indentUnit.of("  "));

  client.undoHistoryCompartment = new Compartment();
  const undoHistory = client.undoHistoryCompartment.of([history()]);

  const vimMode = client.ui.viewState.uiOptions.vimMode;

  if (vimMode) {
    void enableVimMode(client);
  }

  const readOnlyExtensions: Extension[] =
    readOnly ||
    client.ui.viewState.uiOptions.forcedROMode ||
    client.bootConfig.readOnly
      ? [
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          readOnlyCursorActive,
        ]
      : [];

  return [
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

    client.vimCompartment.of([]),
    readOnlyExtensions,
    syntaxHighlighting(editorHighlightStyle()),
    highlightSpecialChars(),
    undoHistory,
    dropCursor(),
    indentUnits,
    indentOnInput(),
    drawSelection(),
    regularKeyBindings,
    closeBrackets(),
    buildEditorUpdateListener(client, mode),
  ];
}

export function buildPageExtensions(
  client: Client,
  pageName: string,
): Extension[] {
  let touchCount = 0;
  let lastMouseDown: { x: number; y: number } | null = null;
  client.markdownLanguageCompartment = new Compartment();
  return [
    client.markdownLanguageCompartment.of(
      buildMarkdownLanguageExtension(client),
    ),
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
      addToOptions: [
        {
          position: 20,
          render(completion) {
            return (
              createIconElement(
                (completion as DecoratedCompletion).icon,
                "sb-page-decoration-icon",
              ) ?? null
            );
          },
        },
      ],
    }),
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocorrect: "on",
      autocapitalize: "on",
    }),
    inlineContentPlugin(client),
    codeCopyPlugin(client),
    externalPresence(),
    conflictMarkers(client),
    codeFolding({
      preparePlaceholder: prepareFrontmatterFoldPlaceholder,
      placeholderDOM: (view, onclick, prepared) =>
        frontmatterFoldPlaceholderDOM(view, onclick, prepared, client),
    }),
    frontmatterFoldingExtension(client),
    ...cleanModePlugins(client),
    EditorView.lineWrapping,
    plugLinter(client),
    postScriptPrefacePlugin(client),
    lineWrapper([
      { selector: "ATXHeading1", class: "sb-line-h1" },
      { selector: "ATXHeading2", class: "sb-line-h2" },
      { selector: "ATXHeading3", class: "sb-line-h3" },
      { selector: "ATXHeading4", class: "sb-line-h4" },
      { selector: "ATXHeading5", class: "sb-line-h5" },
      { selector: "ATXHeading6", class: "sb-line-h6" },
      { selector: "ListItem", class: "sb-line-li", nesting: true },
      { selector: "Blockquote", class: "sb-line-blockquote", nesting: true },
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
              await client.dispatchAppEvent("page:click", potentialClickEvent);
            }
          });
        }
        touchCount = 0;
      },

      mousedown: (event: MouseEvent) => {
        lastMouseDown = { x: event.clientX, y: event.clientY };
      },

      click: (event: MouseEvent, view: EditorView) => {
        const pos = view.posAtCoords(event);
        if (event.button !== 0) {
          return;
        }
        if (!pos) {
          return;
        }
        // Releasing a drag-selection also produces a `click` (on the common
        // ancestor of the mousedown/mouseup targets). Only treat it as a
        // click when the pointer stayed put since mousedown; a missing
        // mousedown means it landed on a widget, so the targets differed.
        const mouseDown = lastMouseDown;
        lastMouseDown = null;
        if (
          !mouseDown ||
          Math.hypot(event.clientX - mouseDown.x, event.clientY - mouseDown.y) >
            4
        ) {
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
              await client.dispatchAppEvent("page:click", potentialClickEvent);
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
    pasteLinkExtension,
    documentExtension(client),
  ];
}

export function buildTextDocumentExtensions(
  language: Language | null,
): Extension[] {
  return [
    EditorState.lineSeparator.of("\n"),
    language ?? [],
    autocompletion(),
    codeFolding(),
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    }),
  ];
}

export function buildEditorUpdateListener(
  client: Client,
  mode: EditorMode,
): Extension {
  return ViewPlugin.define(() => ({
    update: createEditorUpdateHandler(client, mode),
  }));
}

export function createEditorUpdateHandler(
  client: Client,
  mode: EditorMode,
): (update: ViewUpdate) => void {
  let composingDirty = false;
  const changedAction =
    mode.kind === "page" ? "page-changed" : "document-editor-changed";
  const save = () => {
    if (mode.kind === "page") client.contentManager.debouncedUpdateEvent();
    client.save().catch((e) => console.error("Error saving", e));
  };
  return (update) => {
    if (mode.kind === "page") {
      for (const tr of update.transactions) {
        for (const e of tr.effects) {
          if (e.is(foldEffect))
            void client.dispatchAppEvent("editor:fold", e.value);
          if (e.is(unfoldEffect))
            void client.dispatchAppEvent("editor:unfold", e.value);
        }
      }
    }
    if (update.docChanged) {
      if (update.transactions.some((t) => t.annotation(externalUpdate))) return;
      if (update.view.composing) {
        composingDirty = true;
        client.ui.viewDispatch({ type: changedAction });
        return;
      }
      if (mode.kind === "page") {
        const changes: TextChange[] = [];
        update.changes.iterChanges((fromA, toA, fromB, toB, inserted) =>
          changes.push({
            inserted: inserted.toString(),
            oldRange: { from: fromA, to: toA },
            newRange: { from: fromB, to: toB },
          }),
        );
        void client.dispatchAppEvent("editor:pageModified", { changes });
      }
      client.ui.viewDispatch({ type: changedAction });
      save();
      composingDirty = false;
    } else if (composingDirty && !update.view.composing) {
      composingDirty = false;
      save();
    }
  };
}

/**
 * Synchronously parse the region of the document that is about to become
 * visible, so live-preview decorations are present on the first paint instead
 * of flashing raw markdown. A fresh editor state only parses the first ~3000
 * characters; the background parser resumes after an idle pause (a fixed
 * 500ms in WebKit, which lacks requestIdleCallback). Must be called in the
 * same task as `setState`/navigation, before the browser paints.
 *
 * `scrollTop` is the scroll position that is about to be restored, if any.
 */
export function forceParseVisibleRegion(view: EditorView, scrollTop?: number) {
  let upto = view.viewport.to;
  if (scrollTop) {
    upto = Math.max(
      upto,
      view.lineBlockAtHeight(scrollTop + view.scrollDOM.clientHeight).to,
    );
  }
  upto = Math.max(upto, view.state.selection.main.to);
  forceParsing(view, Math.min(view.state.doc.length, upto + 2500), 100);
}

export function createCommandKeyBindings(
  client: Client,
  mode = client.contentManager.hostEditorMode,
  documentReadOnly = client.currentPageMeta()?.perm === "ro",
): Extension {
  const commandKeyBindings: KeyBinding[] = [];
  const vimMode = client.ui.viewState.uiOptions.vimMode;
  const readOnly =
    documentReadOnly ||
    client.bootConfig.readOnly ||
    client.ui.viewState.uiOptions.forcedROMode;
  const currentEditor =
    mode?.kind === "text-document"
      ? "TextEditor"
      : mode?.kind === "page"
        ? undefined
        : client.contentManager.documentEditor?.name;

  for (const def of client.clientSystem.commandHook
    .buildAllCommands()
    .values()) {
    const requiredEditor = def.requireEditor;

    if (def.disableInVim && vimMode) {
      continue;
    }

    // Don't bind write-mode commands when read-only (covers per-page read-only,
    // which CommandHook's space-wide filter doesn't account for).
    if (readOnly && def.requireMode === "rw") {
      continue;
    }

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
            if (returnValue !== false) {
              client.focus();
            }
          });

        return true;
      };
      if (def.key && (!isMacLike || (isMacLike && !def.mac))) {
        if (Array.isArray(def.key)) {
          for (const key of def.key) {
            commandKeyBindings.push({ key, run });
          }
        } else {
          commandKeyBindings.push({ key: def.key, run });
        }
      }
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

export function createRegularKeyBindings(
  client: Client,
  mode: EditorMode,
): Extension {
  if (mode.kind === "text-document") {
    return keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]);
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
        : []),
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
      addKeymap: false,
    }),
    Prec.high(
      keymap.of([
        {
          key: "Enter",
          run: customEnterCommand,
        },
        { key: "Backspace", run: deleteMarkupBackward },
      ]),
    ),
    markdownLanguage.data.of({
      closeBrackets: {
        brackets: client.config.get("autoCloseBrackets", "([{").split(""),
      },
    }),
  ];
}
