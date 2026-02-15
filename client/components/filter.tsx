import type { ComponentProps } from "preact";
import type { X } from "preact-feather";

type FeatherProps = ComponentProps<typeof X>;
import type { FunctionalComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { MiniEditor } from "./mini_editor.tsx";
import { fuzzySearchAndSort } from "../lib/fuse_search.ts";
import { deepEqual } from "../../plug-api/lib/json.ts";
import { AlwaysShownModal } from "./basic_modals.tsx";
import type { EditorView } from "@codemirror/view";

export function FilterList({
  placeholder,
  options,
  label,
  onSelect,
  onKeyPress,
  vimMode,
  darkMode,
  preFilter,
  phrasePreprocessor,
  allowNew = false,
  helpText = "",
  completePrefix,
  icon: Icon,
  newHint,
}: {
  placeholder: string;
  options: FilterOption[];
  label: string;
  onKeyPress?: (view: EditorView, event: KeyboardEvent) => boolean;
  onSelect: (option: FilterOption | undefined) => void;
  preFilter?: (options: FilterOption[], phrase: string) => FilterOption[];
  phrasePreprocessor?: (phrase: string) => string;
  vimMode: boolean;
  darkMode?: boolean;
  allowNew?: boolean;
  completePrefix?: string;
  helpText: string;
  newHint?: string;
  icon?: FunctionalComponent<FeatherProps>;
}) {
  const [text, setText] = useState("");
  const [matchingOptions, setMatchingOptions] = useState(
    fuzzySearchAndSort(
      preFilter ? preFilter(options, "") : options,
      "",
    ),
  );
  const [selectedOption, setSelectionOption] = useState(0);

  const selectedElementRef = useRef<HTMLDivElement>(null);

  function updateFilter(originalPhrase: string) {
    const prefilteredOptions = preFilter
      ? preFilter(options, originalPhrase)
      : options;
    if (phrasePreprocessor) {
      originalPhrase = phrasePreprocessor(originalPhrase);
    }
    const results = fuzzySearchAndSort(prefilteredOptions, originalPhrase);
    const foundExactMatch = !!results.find((result) =>
      result.name === originalPhrase
    );
    if (allowNew && !foundExactMatch && originalPhrase) {
      results.splice(1, 0, {
        name: originalPhrase,
        hint: newHint,
      });
    }

    if (!deepEqual(matchingOptions, results)) {
      // Only do this (=> rerender of UI) if the results have changed
      setMatchingOptions(results);
      setSelectionOption(0);
    }
  }

  useEffect(() => {
    updateFilter(text);
  }, [options, text]);

  useEffect(() => {
    function closer() {
      onSelect(undefined);
    }

    document.addEventListener("click", closer);

    return () => {
      document.removeEventListener("click", closer);
    };
  }, []);

  const returnEl = (
    <AlwaysShownModal
      onCancel={() => {
        onSelect(undefined);
      }}
    >
      <div
        className="sb-header"
        onClick={(e) => {
          // Allow tapping/clicking the header without closing it
          e.stopPropagation();
        }}
      >
        <label>{label}</label>
        <MiniEditor
          text={text}
          vimMode={vimMode}
          vimStartInInsertMode={true}
          focus={true}
          darkMode={darkMode}
          placeholderText={placeholder}
          onEnter={(_newText, shiftDown) => {
            onSelect(
              shiftDown
                ? { name: text, type: "page" }
                : matchingOptions[selectedOption],
            );
            return true;
          }}
          onEscape={() => {
            onSelect(undefined);
          }}
          onChange={(text) => {
            setText(text);
          }}
          onKeyUp={(view, e) => {
            if (e.code === "Space" && e.altKey) {
              if (matchingOptions.length > 0) {
                const text = view.state.sliceDoc().trimEnd(); // space already added, remove it
                const option = matchingOptions[0];
                if (option.name.toLowerCase().startsWith(text.toLowerCase())) {
                  // If the prefixes are the same, add one more segment
                  let nextSlash = option.name.indexOf("/", text.length + 1);
                  if (nextSlash === -1) {
                    nextSlash = Infinity;
                  }
                  setText(option.name.slice(0, nextSlash));
                } else {
                  setText(`${option.name.split("/")[0]}/`);
                }
              }
              return true;
            }
            if (onKeyPress) {
              return onKeyPress(view, e);
            }
            return false;
          }}
          onKeyDown={(view, e) => {
            if (
              e.key === "ArrowUp" ||
              e.ctrlKey && e.key === "p"
            ) {
              setSelectionOption(Math.max(0, selectedOption - 1));
            } else if (
              e.key === "ArrowDown" ||
              e.ctrlKey && e.key === "n"
            ) {
              setSelectionOption(
                Math.min(matchingOptions.length - 1, selectedOption + 1),
              );
            } else if (e.key === "PageUp") {
              setSelectionOption(Math.max(0, selectedOption - 5));
            } else if (e.key === "PageDown") {
              setSelectionOption(
                Math.min(matchingOptions.length - 1, selectedOption + 5),
              );
            } else if (e.key === "Home") {
              setSelectionOption(0);
            } else if (e.key === "End") {
              setSelectionOption(matchingOptions.length - 1);
            } else if (
              (e.key === " ") && completePrefix &&
              (view.state.sliceDoc() === "")
            ) {
              setText(completePrefix);
            } else {
              return false;
            }

            setTimeout(() => {
              selectedElementRef.current?.scrollIntoView({
                block: "nearest",
              });
            });

            return true;
          }}
          editable={true}
        />
      </div>
      <div
        className="sb-help-text"
        dangerouslySetInnerHTML={{ __html: helpText }}
      >
      </div>
      <div className="sb-result-list" tabIndex={-1}>
        {matchingOptions && matchingOptions.length > 0
          ? (() => {
            let optionIndex = 0;

            return matchingOptions.map((option) => {
              const currentOptionIndex = optionIndex;
              optionIndex++;

              return (
                <div
                  key={`option-${currentOptionIndex}`}
                  ref={selectedOption === currentOptionIndex
                    ? selectedElementRef
                    : undefined}
                  className={(selectedOption === currentOptionIndex
                    ? "sb-option sb-selected-option"
                    : "sb-option") +
                    (option.cssClass
                      ? " sb-decorated-object " + option.cssClass
                      : "")}
                  onMouseMove={() => {
                    if (selectedOption !== currentOptionIndex) {
                      setSelectionOption(currentOptionIndex);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(option);
                  }}
                >
                  {Icon && (
                    <span className="sb-icon">
                      <Icon width={16} height={16} />
                    </span>
                  )}
                  <span className="sb-name">
                    {(option.prefix ?? "") + option.name}
                  </span>
                  {option.hint && (
                    <span
                      className={"sb-hint" +
                        (option.hintInactive ? " sb-hint-inactive" : "")}
                    >
                      {option.hint}
                    </span>
                  )}
                  <div className="sb-description">
                    {option.description}
                  </div>
                </div>
              );
            });
          })()
          : null}
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}
