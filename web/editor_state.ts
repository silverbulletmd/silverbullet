import buildMarkdown from "../common/markdown_parser/parser.ts";
import { readonlyMode } from "./cm_plugins/readonly.ts";
import customMarkdownStyle from "./style.ts";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  codeFolding,
  completionKeymap,
  drawSelection,
  dropCursor,
  EditorState,
  EditorView,
  highlightSpecialChars,
  history,
  historyKeymap,
  indentOnInput,
  indentWithTab,
  KeyBinding,
  keymap,
  LanguageDescription,
  LanguageSupport,
  markdown,
  searchKeymap,
  standardKeymap,
  syntaxHighlighting,
  ViewPlugin,
  ViewUpdate,
} from "../common/deps.ts";
import { Client } from "./client.ts";
import { vim } from "./deps.ts";
import { inlineImagesPlugin } from "./cm_plugins/inline_image.ts";
import { cleanModePlugins } from "./cm_plugins/clean.ts";
import { lineWrapper } from "./cm_plugins/line_wrapper.ts";
import { smartQuoteKeymap } from "./cm_plugins/smart_quotes.ts";
import { safeRun } from "../common/util.ts";
import { ClickEvent } from "$sb/app_event.ts";
import {
  attachmentExtension,
  pasteLinkExtension,
} from "./cm_plugins/editor_paste.ts";
import { TextChange } from "$sb/lib/change.ts";
import { postScriptPlugin } from "./cm_plugins/post_script.ts";
import { languageFor } from "../common/languages.ts";

export function createEditorState(
  editor: Client,
  pageName: string,
  text: string,
  readOnly: boolean,
): EditorState {
  const commandKeyBindings: KeyBinding[] = [];
  for (const def of editor.system.commandHook.editorCommands.values()) {
    if (def.command.key) {
      commandKeyBindings.push({
        key: def.command.key,
        mac: def.command.mac,
        run: (): boolean => {
          if (def.command.contexts) {
            const context = editor.getContext();
            if (!context || !def.command.contexts.includes(context)) {
              return false;
            }
          }
          Promise.resolve()
            .then(def.run)
            .catch((e: any) => {
              console.error(e);
              editor.flashNotification(
                `Error running command: ${e.message}`,
                "error",
              );
            })
            .then(() => {
              // Always be focusing the editor after running a command
              editor.focus();
            });
          return true;
        },
      });
    }
  }
  let touchCount = 0;

  const markdownLanguage = buildMarkdown(editor.system.mdExtensions);

  return EditorState.create({
    doc: text,
    extensions: [
      // Not using CM theming right now, but some extensions depend on the "dark" thing
      EditorView.theme({}, {
        dark: editor.ui.viewState.uiOptions.darkMode,
      }),
      // Enable vim mode, or not
      [
        ...editor.ui.viewState.uiOptions.vimMode ? [vim({ status: true })] : [],
      ],
      [
        ...readOnly || editor.ui.viewState.uiOptions.forcedROMode
          ? [readonlyMode()]
          : [],
      ],
      // The uber markdown mode
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

          return null;
        },
        addKeymap: true,
      }),
      markdownLanguage.data.of({
        closeBrackets: { brackets: ["(", "{", "[", "`"] },
      }),
      syntaxHighlighting(customMarkdownStyle(editor.system.mdExtensions)),
      autocompletion({
        override: [
          editor.editorComplete.bind(editor),
          editor.system.slashCommandHook.slashCommandCompleter.bind(
            editor.system.slashCommandHook,
          ),
        ],
      }),
      inlineImagesPlugin(editor),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      codeFolding({
        placeholderText: "…",
      }),
      indentOnInput(),
      ...cleanModePlugins(editor),
      EditorView.lineWrapping,
      postScriptPlugin(editor),
      lineWrapper([
        { selector: "ATXHeading1", class: "sb-line-h1" },
        { selector: "ATXHeading2", class: "sb-line-h2" },
        { selector: "ATXHeading3", class: "sb-line-h3" },
        { selector: "ATXHeading4", class: "sb-line-h4" },
        { selector: "ListItem", class: "sb-line-li", nesting: true },
        { selector: "Blockquote", class: "sb-line-blockquote" },
        { selector: "Task", class: "sb-line-task" },
        { selector: "CodeBlock", class: "sb-line-code" },
        {
          selector: "FencedCode",
          class: "sb-line-fenced-code",
          disableSpellCheck: true,
        },
        { selector: "Comment", class: "sb-line-comment" },
        { selector: "BulletList", class: "sb-line-ul" },
        { selector: "OrderedList", class: "sb-line-ol" },
        { selector: "TableHeader", class: "sb-line-tbl-header" },
        { selector: "FrontMatter", class: "sb-frontmatter" },
      ]),
      keymap.of([
        ...smartQuoteKeymap,
        ...closeBracketsKeymap,
        ...standardKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
        ...commandKeyBindings,
        {
          key: "Ctrl-k",
          mac: "Cmd-k",
          run: (): boolean => {
            editor.ui.viewDispatch({ type: "start-navigate" });
            editor.space.updatePageList();

            return true;
          },
        },
        {
          key: "Ctrl-/",
          mac: "Cmd-/",
          run: (): boolean => {
            editor.ui.viewDispatch({
              type: "show-palette",
              context: editor.getContext(),
            });
            return true;
          },
        },
        {
          key: "Ctrl-.",
          mac: "Cmd-.",
          run: (): boolean => {
            editor.ui.viewDispatch({
              type: "show-palette",
              context: editor.getContext(),
            });
            return true;
          },
        },
      ]),
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

              const clickEvent: ClickEvent = {
                page: pageName,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                pos: view.posAtCoords({
                  x: touch.clientX,
                  y: touch.clientY,
                })!,
              };
              await editor.dispatchAppEvent("page:click", clickEvent);
            });
          }
          touchCount = 0;
        },

        mousedown: (event: MouseEvent, view: EditorView) => {
          safeRun(async () => {
            const pos = view.posAtCoords(event);
            if (!pos) {
              return;
            }
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
                await editor.dispatchAppEvent(
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
              await editor.dispatchAppEvent("page:click", potentialClickEvent);
            }
          });
        },
      }),
      ViewPlugin.fromClass(
        class {
          update(update: ViewUpdate): void {
            if (update.docChanged) {
              const changes: TextChange[] = [];
              update.changes.iterChanges((fromA, toA, fromB, toB, inserted) =>
                changes.push({
                  inserted: inserted.toString(),
                  oldRange: { from: fromA, to: toA },
                  newRange: { from: fromB, to: toB },
                })
              );
              editor.dispatchAppEvent("editor:pageModified", { changes });
              editor.ui.viewDispatch({ type: "page-changed" });
              editor.debouncedUpdateEvent();
              editor.save().catch((e) => console.error("Error saving", e));
            }
          }
        },
      ),
      pasteLinkExtension,
      attachmentExtension(editor),
      closeBrackets(),
    ],
  });
}
