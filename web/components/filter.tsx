import type { FeatherProps } from "preact-feather/types";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { FunctionalComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { MiniEditor } from "./mini_editor.tsx";
import { fuzzySearchAndSort } from "../fuse_search.ts";
import { deepEqual } from "../../plug-api/lib/json.ts";
import { AlwaysShownModal } from "./basic_modals.tsx";

export function FilterList({
  placeholder,
  options,
  label,
  onSelect,
  onKeyPress,
  completer,
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
  onKeyPress?: (key: string, currentText: string) => void;
  onSelect: (option: FilterOption | undefined) => void;
  preFilter?: (options: FilterOption[], phrase: string) => FilterOption[];
  phrasePreprocessor?: (phrase: string) => string;
  vimMode: boolean;
  darkMode?: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
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

  // Group options by category while preserving Fuse.js order
  function groupOptionsByCategory(
    options: FilterOption[],
  ): Array<
    { type: "category"; name: string } | {
      type: "option";
      option: FilterOption;
      originalIndex: number;
    }
  > {
    const grouped: Array<
      { type: "category"; name: string } | {
        type: "option";
        option: FilterOption;
        originalIndex: number;
      }
    > = [];
    const seenCategories = new Set<string>();

    let originalIndex = 0;
    for (const option of options) {
      if (option.category && !seenCategories.has(option.category)) {
        seenCategories.add(option.category);
        grouped.push({ type: "category", name: option.category });
      }
      grouped.push({ type: "option", option, originalIndex });
      originalIndex++;
    }

    return grouped;
  }

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
          completer={completer}
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
            // This event is triggered after the key has been processed by CM already
            if (onKeyPress) {
              onKeyPress(e.key, view.state.sliceDoc());
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
            const groupedItems = groupOptionsByCategory(matchingOptions);
            let optionIndex = 0;

            return groupedItems.map((item) => {
              if (item.type === "category") {
                return (
                  <div
                    key={`category-${item.name}`}
                    className="sb-category-header"
                  >
                    {item.name}
                  </div>
                );
              } else {
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
                      (item.option.cssClass
                        ? " sb-decorated-object " + item.option.cssClass
                        : "")}
                    onMouseMove={() => {
                      if (selectedOption !== currentOptionIndex) {
                        setSelectionOption(currentOptionIndex);
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item.option);
                    }}
                  >
                    {Icon && (
                      <span className="sb-icon">
                        <Icon width={16} height={16} />
                      </span>
                    )}
                    <span className="sb-name">
                      {(() => {
                        let displayName = item.option.name;
                        // Remove category prefix for display (e.g., "Block: Close Sidebar" -> "Close Sidebar")
                        if (
                          item.option.category &&
                          displayName.startsWith(item.option.category + ": ")
                        ) {
                          displayName = displayName.substring(
                            item.option.category.length + 2,
                          );
                        }
                        return displayName;
                      })()}
                    </span>
                    {item.option.hint && (
                      <span
                        className={"sb-hint" +
                          (item.option.hintInactive ? " sb-hint-inactive" : "")}
                      >
                        {item.option.hint}
                      </span>
                    )}
                    <div className="sb-description">
                      {item.option.description}
                    </div>
                  </div>
                );
              }
            });
          })()
          : null}
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}
