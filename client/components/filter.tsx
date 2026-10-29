import type { ComponentProps } from "preact";
import type { X } from "preact-feather";

type FeatherProps = ComponentProps<typeof X>;
import type { FunctionalComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { fuzzySearchAndSort } from "../lib/fuzzy_search.ts";
import { shouldFocusModalFilter } from "../lib/mobile.ts";
import { deepEqual } from "../../plug-api/lib/json.ts";
import { AlwaysShownModal } from "./basic_modals.tsx";

/** An option for typed text that isn't in the list; `isNew` tells it apart */
export function newEntry(name: string, hint?: string): FilterOption {
  return hint === undefined
    ? { name, isNew: true }
    : { name, hint, isNew: true };
}

/**
 * Offers `phrase` as the second option when no option has exactly that name,
 * so Enter still picks the best match and ArrowDown, Enter creates.
 */
export function offerNewEntry(
  results: FilterOption[],
  phrase: string,
  hint?: string,
): FilterOption[] {
  if (phrase && !results.some((result) => result.name === phrase)) {
    results.splice(1, 0, newEntry(phrase, hint));
  }
  return results;
}

export function FilterList({
  placeholder,
  options,
  label,
  onSelect,
  onKeyPress,
  onPhraseChange,
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
  onKeyPress?: (value: string, event: KeyboardEvent) => boolean;
  onPhraseChange?: (phrase: string) => void;
  onSelect: (option: FilterOption | undefined) => void;
  preFilter?: (options: FilterOption[], phrase: string) => FilterOption[];
  phrasePreprocessor?: (phrase: string) => string;
  darkMode?: boolean;
  allowNew?: boolean;
  completePrefix?: string;
  helpText: string;
  newHint?: string;
  icon?: FunctionalComponent<FeatherProps>;
}) {
  const [text, setText] = useState("");
  const [matchingOptions, setMatchingOptions] = useState(
    fuzzySearchAndSort(preFilter ? preFilter(options, "") : options, ""),
  );
  const [selectedOption, setSelectionOption] = useState(0);

  const selectedElementRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autofocus = shouldFocusModalFilter();
  useEffect(() => {
    // See the matching skip in the navigator's `focusInput`: on a touch
    // device this focus leaves the field focused with no on-screen
    // keyboard, and no tap can recover one. Keyboard shortcuts and
    // attached keyboards still focus so the user can type immediately.
    if (!autofocus) return;
    inputRef.current?.focus();
  }, []);

  function updateFilter(originalPhrase: string) {
    const prefilteredOptions = preFilter
      ? preFilter(options, originalPhrase)
      : options;
    if (phrasePreprocessor) {
      originalPhrase = phrasePreprocessor(originalPhrase);
    }
    const results = fuzzySearchAndSort(prefilteredOptions, originalPhrase);
    if (allowNew) offerNewEntry(results, originalPhrase, newHint);

    if (!deepEqual(matchingOptions, results)) {
      setMatchingOptions(results);
      setSelectionOption(0);
    }
  }

  useEffect(() => {
    updateFilter(text);
  }, [options, text]);

  useEffect(() => {
    onPhraseChange?.(text);
  }, [text]);

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
      {/* Built from the navigator's (page picker's) classes so the two look
          alike; see client/styles/_navigator.scss */}
      <div className="sb-nav-root sb-nav-root-modal sb-filter-box">
        <div
          className="sb-nav-header"
          onClick={(e) => {
            // Allow tapping/clicking the header without closing it
            e.stopPropagation();
          }}
        >
          <div className="sb-nav-header-row">
            <label className="sb-nav-title">{label}</label>
            <input
              ref={inputRef}
              className="sb-nav-input"
              type="text"
              autofocus={autofocus}
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              value={text}
              placeholder={placeholder}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                // While composing with an IME (e.g. selecting a CJK candidate),
                // let the input/IME handle every key — don't select/navigate.
                if (e.isComposing) {
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSelect(
                    e.shiftKey && allowNew && text
                      ? newEntry(text)
                      : matchingOptions[selectedOption],
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onSelect(undefined);
                  return;
                }
                if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
                  setSelectionOption(Math.max(0, selectedOption - 1));
                } else if (
                  e.key === "ArrowDown" ||
                  (e.ctrlKey && e.key === "n")
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
                  e.key === " " &&
                  completePrefix &&
                  e.currentTarget.value === ""
                ) {
                  setText(completePrefix);
                } else {
                  return;
                }
                e.preventDefault();
                setTimeout(() => {
                  selectedElementRef.current?.scrollIntoView({
                    block: "nearest",
                  });
                });
              }}
              onKeyUp={(e) => {
                if (e.code === "Space" && e.altKey) {
                  if (matchingOptions.length > 0) {
                    const value = e.currentTarget.value.trimEnd();
                    const option = matchingOptions[0];
                    if (
                      option.name.toLowerCase().startsWith(value.toLowerCase())
                    ) {
                      let nextSlash = option.name.indexOf(
                        "/",
                        value.length + 1,
                      );
                      if (nextSlash === -1) {
                        nextSlash = Infinity;
                      }
                      setText(option.name.slice(0, nextSlash));
                    } else {
                      setText(`${option.name.split("/")[0]}/`);
                    }
                  }
                  return;
                }
                if (onKeyPress) {
                  onKeyPress(e.currentTarget.value, e);
                }
              }}
            />
          </div>
        </div>
        {helpText && (
          <div
            className="sb-nav-help"
            dangerouslySetInnerHTML={{ __html: helpText }}
          ></div>
        )}
        <div className="sb-nav-body sb-result-list" tabIndex={-1}>
          {matchingOptions && matchingOptions.length > 0
            ? (() => {
                let optionIndex = 0;

                return matchingOptions.map((option) => {
                  const currentOptionIndex = optionIndex;
                  optionIndex++;

                  return (
                    <div
                      key={`option-${currentOptionIndex}`}
                      ref={
                        selectedOption === currentOptionIndex
                          ? selectedElementRef
                          : undefined
                      }
                      className={
                        // `sb-option`/`sb-selected-option` are kept as hooks
                        // for user CSS (see docs/Page Decorations.md)
                        (selectedOption === currentOptionIndex
                          ? "sb-nav-row sb-nav-selected sb-option sb-selected-option"
                          : "sb-nav-row sb-option") +
                        (option.cssClass
                          ? ` sb-decorated-object ${option.cssClass}`
                          : "")
                      }
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
                        <span className="sb-nav-icon">
                          <Icon width={16} height={16} />
                        </span>
                      )}
                      <span className="sb-nav-primary">
                        {(option.prefix ?? "") + option.name}
                      </span>
                      {option.description && (
                        <span className="sb-nav-description" dir="auto">
                          {option.description}
                        </span>
                      )}
                      {option.hint && (
                        <span
                          className={
                            "sb-nav-chip sb-nav-chip-hint" +
                            (option.hintInactive ? " sb-nav-chip-inactive" : "")
                          }
                        >
                          {option.hint}
                        </span>
                      )}
                    </div>
                  );
                });
              })()
            : null}
        </div>
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}
