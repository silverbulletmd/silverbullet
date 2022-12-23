import {
  CompletionContext,
  CompletionResult,
  useEffect,
  useRef,
  useState,
} from "../deps.ts";
import { FilterOption } from "../../common/types.ts";
import fuzzysort from "https://esm.sh/fuzzysort@2.0.1";
import { FunctionalComponent } from "https://esm.sh/v99/preact@10.11.3/src/index";
import { FeatherProps } from "https://esm.sh/v99/preact-feather@4.2.1/dist/types";
import { MiniEditor } from "./mini_editor.tsx";

function magicSorter(a: FilterOption, b: FilterOption): number {
  if (a.orderId && b.orderId) {
    return a.orderId < b.orderId ? -1 : 1;
  }
  if (a.orderId) {
    return -1;
  }
  if (b.orderId) {
    return 1;
  }
  return 0;
}

type FilterResult = FilterOption & {
  result?: any;
};

function simpleFilter(
  pattern: string,
  options: FilterOption[],
): FilterOption[] {
  const lowerPattern = pattern.toLowerCase();
  return options.filter((option) => {
    return option.name.toLowerCase().includes(lowerPattern);
  });
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fuzzySorter(pattern: string, options: FilterOption[]): FilterResult[] {
  return fuzzysort
    .go(pattern, options, {
      all: true,
      key: "name",
    })
    .map((result: any) => ({ ...result.obj, result: result }))
    .sort(magicSorter);
}

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
    fuzzySorter("", options),
  );
  const [selectedOption, setSelectionOption] = useState(0);

  const selectedElementRef = useRef<HTMLDivElement>(null);

  function updateFilter(originalPhrase: string) {
    const foundExactMatch = false;
    const results = fuzzySorter(originalPhrase, options);
    if (allowNew && !foundExactMatch && originalPhrase) {
      results.splice(1, 0, {
        name: originalPhrase,
        hint: newHint,
      });
    }
    setMatchingOptions(results);

    // setText(originalPhrase);
    setSelectionOption(0);
  }

  useEffect(() => {
    updateFilter(text);
  }, [options]);

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

  useEffect(() => {
    // TODO: why is this called after each setSelectionOption
    // TODO: up / down also moves cursor inside MiniEditor to begin / end
    function onKeyDown(e: KeyboardEvent) : boolean {
      const nOptions = matchingOptions.length;
      if (nOptions === 0) {
        return false;
      }
      let newSelected : number | undefined;
      switch (e.key) {
        case "ArrowUp":
          newSelected = selectedOption - 1;
          break;
        case "ArrowDown":
          newSelected = selectedOption + 1;
          break;
        case "PageUp":
          newSelected = selectedOption - 5;
          break;
        case "PageDown":
          newSelected = selectedOption + 5;
          break;
        case "Home":
          newSelected = 0;
          break;
        case "End":
          newSelected = nOptions - 1;
          break;
      }
      if (newSelected === undefined || nOptions < 1) {
        return true;
      }
      if (newSelected < 0) {
        newSelected = 0;
      }
      if (newSelected >= nOptions) {
        newSelected = nOptions - 1;
      }
      setSelectionOption(newSelected);
      return true;
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };

  }, [selectedOption, matchingOptions]);

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
              updateFilter(text);
            }}
            onKeyUp={(view, e) => {
              if (onKeyPress) {
                onKeyPress(e.key, view.state.sliceDoc());
              }
              switch (e.key) {
                case " ": {
                  const text = view.state.sliceDoc();
                  if (completePrefix && text === " ") {
                    console.log("Doing the complete thing");
                    setText(completePrefix);
                    updateFilter(completePrefix);
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
                  console.log("Selecting", option);
                  e.stopPropagation();
                  onSelect(option);
                }}
              >
                {Icon && (
                  <span className="sb-icon">
                    <Icon width={16} height={16} />
                  </span>
                )}
                <span
                  className="sb-name"
                  dangerouslySetInnerHTML={{
                    __html: option?.result?.indexes
                      ? fuzzysort.highlight(option.result, "<b>", "</b>")!
                      : escapeHtml(option.name),
                  }}
                >
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
