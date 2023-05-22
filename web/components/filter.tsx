import {
  CompletionContext,
  CompletionResult,
  useEffect,
  useRef,
  useState,
} from "../deps.ts";
import { FilterOption } from "../types.ts";
import { FunctionalComponent } from "https://esm.sh/v99/preact@10.11.3/src/index";
import { FeatherProps } from "https://esm.sh/v99/preact-feather@4.2.1/dist/types";
import { MiniEditor } from "./mini_editor.tsx";
import { fuzzySearchAndSort } from "./fuzzy_search.ts";

type FilterResult = FilterOption & {
  result?: any;
};

export function FilterList({
  placeholder,
  options,
  label,
  onSelect,
  onKeyPress,
  completer,
  vimMode,
  darkMode,
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
  vimMode: boolean;
  darkMode: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  allowNew?: boolean;
  completePrefix?: string;
  helpText: string;
  newHint?: string;
  icon?: FunctionalComponent<FeatherProps>;
}) {
  const [text, setText] = useState("");
  const [matchingOptions, setMatchingOptions] = useState(
    fuzzySearchAndSort(options, ""),
  );
  const [selectedOption, setSelectionOption] = useState(0);

  const selectedElementRef = useRef<HTMLDivElement>(null);

  function updateFilter(originalPhrase: string) {
    const results = fuzzySearchAndSort(options, originalPhrase);
    const foundExactMatch = !!results.find((result) =>
      result.name === originalPhrase
    );
    if (allowNew && !foundExactMatch && originalPhrase) {
      results.splice(1, 0, {
        name: originalPhrase,
        hint: newHint,
      });
    }

    setMatchingOptions(results);
    setSelectionOption(0);
  }

  useEffect(() => {
    updateFilter(text);
  }, [options, text]);

  useEffect(() => {
    function closer() {
      console.log("Invoking closer");
      onSelect(undefined);
    }

    document.addEventListener("click", closer);

    return () => {
      document.removeEventListener("click", closer);
    };
  }, []);

  const returnEl = (
    <div className="sb-modal-wrapper">
      <div className="sb-modal-box">
        <div className="sb-header">
          <label>{label}</label>
          <MiniEditor
            text={text}
            vimMode={vimMode}
            vimStartInInsertMode={true}
            focus={true}
            darkMode={darkMode}
            completer={completer}
            placeholderText={placeholder}
            onEnter={() => {
              onSelect(matchingOptions[selectedOption]);
              return true;
            }}
            onEscape={() => {
              onSelect(undefined);
            }}
            onChange={(text) => {
              setText(text);
              // updateFilter(text);
            }}
            onKeyUp={(view, e) => {
              // This event is triggered after the key has been processed by CM already
              if (onKeyPress) {
                onKeyPress(e.key, view.state.sliceDoc());
              }
              return false;
            }}
            onKeyDown={(view, e) => {
              switch (e.key) {
                case "ArrowUp":
                  setSelectionOption(Math.max(0, selectedOption - 1));
                  return true;
                case "ArrowDown":
                  setSelectionOption(
                    Math.min(matchingOptions.length - 1, selectedOption + 1),
                  );
                  return true;
                case "PageUp":
                  setSelectionOption(Math.max(0, selectedOption - 5));
                  return true;
                case "PageDown":
                  setSelectionOption(Math.max(0, selectedOption + 5));
                  return true;
                case "Home":
                  setSelectionOption(0);
                  return true;
                case "End":
                  setSelectionOption(matchingOptions.length - 1);
                  return true;
                case " ": {
                  const text = view.state.sliceDoc();
                  if (completePrefix && text === "") {
                    setText(completePrefix);
                    // updateFilter(completePrefix);
                    return true;
                  }
                  break;
                }
              }
              return false;
            }}
          />
        </div>
        <div
          className="sb-help-text"
          dangerouslySetInnerHTML={{ __html: helpText }}
        >
        </div>
        <div className="sb-result-list">
          {matchingOptions && matchingOptions.length > 0
            ? matchingOptions.map((option, idx) => (
              <div
                key={"" + idx}
                ref={selectedOption === idx ? selectedElementRef : undefined}
                className={selectedOption === idx
                  ? "sb-selected-option"
                  : "sb-option"}
                onMouseOver={(e) => {
                  setSelectionOption(idx);
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
                <span className="sb-name" // dangerouslySetInnerHTML={{
                  //   __html: option?.result?.indexes
                  //     ? fuzzysort.highlight(option.result, "<b>", "</b>")!
                  //     : escapeHtml(option.name),
                  // }}
                >
                  {option.name}
                </span>
                {option.hint && <span className="sb-hint">{option.hint}</span>}
              </div>
            ))
            : null}
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    selectedElementRef.current?.scrollIntoView({
      block: "nearest",
    });
  });

  return returnEl;
}
