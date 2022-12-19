import { useEffect, useRef, useState } from "../deps.ts";
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
      onSelect(undefined);
    }

    document.addEventListener("click", closer);

    return () => {
      document.removeEventListener("click", closer);
    };
  }, []);

  let exiting = false;

  // console.log("Rendering", selectedOption);

  const returnEl = (
    <div className="sb-filter-wrapper">
      <div className="sb-filter-box">
        <div className="sb-header">
          <label>{label}</label>
          <MiniEditor
            text={text}
            vimMode={false}
            focus={true}
            onEnter={() => {
              exiting = true;
              onSelect(matchingOptions[selectedOption]);
              return true;
            }}
            onBlur={() => {
              // if (!exiting && searchBoxRef.current) {
              //   searchBoxRef.current.focus();
              // }
            }}
            onKeyUp={(view, e) => {
              if (onKeyPress) {
                onKeyPress(e.key, view.state.sliceDoc());
              }
              switch (e.key) {
                case "ArrowUp":
                  setSelectionOption(Math.max(0, selectedOption - 1));
                  console.log("Up");
                  return true;
                case "ArrowDown":
                  console.log(
                    "Down",
                    matchingOptions.length - 1,
                    selectedOption + 1,
                  );
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
                case "Enter":
                  return false;
                case "Escape":
                  exiting = true;
                  onSelect(undefined);
                  return true;
                case "Space":
                  if (completePrefix && !text) {
                    updateFilter(completePrefix);
                    return true;
                  }
                  break;
                default:
                  updateFilter(view.state.sliceDoc());
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
                  e.preventDefault();
                  exiting = true;
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
