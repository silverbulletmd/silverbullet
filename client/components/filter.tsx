import type { ComponentProps } from "preact";
import type { X } from "preact-feather";

type FeatherProps = ComponentProps<typeof X>;
import type { FunctionalComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { Input } from "@silverbulletmd/silverbullet/ui";
import { fuzzySearchAndSort } from "../lib/fuzzy_search.ts";
import { deepEqual } from "../../plug-api/lib/json.ts";
import { AlwaysShownModal } from "./basic_modals.tsx";

export function FilterList({
  placeholder,
  options,
  label,
  onSelect,
  onKeyPress,
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
  useEffect(() => {
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
    const foundExactMatch = !!results.find(
      (result) => result.name === originalPhrase,
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
        <Input
          inputRef={inputRef}
          class="sb-filter-input"
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
                e.shiftKey
                  ? { name: text, type: "page" }
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
            } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
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
              selectedElementRef.current?.scrollIntoView({ block: "nearest" });
            });
          }}
          onKeyUp={(e) => {
            if (e.code === "Space" && e.altKey) {
              if (matchingOptions.length > 0) {
                const value = e.currentTarget.value.trimEnd();
                const option = matchingOptions[0];
                if (option.name.toLowerCase().startsWith(value.toLowerCase())) {
                  let nextSlash = option.name.indexOf("/", value.length + 1);
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
      <div
        className="sb-help-text"
        dangerouslySetInnerHTML={{ __html: helpText }}
      ></div>
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
                    ref={
                      selectedOption === currentOptionIndex
                        ? selectedElementRef
                        : undefined
                    }
                    className={
                      (selectedOption === currentOptionIndex
                        ? "sb-option sb-selected-option"
                        : "sb-option") +
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
                      <span className="sb-icon">
                        <Icon width={16} height={16} />
                      </span>
                    )}
                    <span className="sb-name">
                      {(option.prefix ?? "") + option.name}
                    </span>
                    {option.hint && (
                      <span
                        className={
                          "sb-hint" +
                          (option.hintInactive ? " sb-hint-inactive" : "")
                        }
                      >
                        {option.hint}
                      </span>
                    )}
                    <div className="sb-description">{option.description}</div>
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
