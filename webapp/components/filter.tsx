import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconDefinition } from "@fortawesome/free-solid-svg-icons";

export type Option = {
  name: string;
  orderId?: number;
  hint?: string;
};

function magicSorter(a: Option, b: Option): number {
  if (a.orderId && b.orderId) {
    return a.orderId < b.orderId ? -1 : 1;
  }
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

function escapeRegExp(str: string): string {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function fuzzyFilter(pattern: string, options: Option[]): Option[] {
  let closeMatchRegex = escapeRegExp(pattern);
  closeMatchRegex = closeMatchRegex.split(/\s+/).join(".*?");
  closeMatchRegex = closeMatchRegex.replace(/\\\//g, ".*?\\/.*?");
  const distantMatchRegex = escapeRegExp(pattern).split("").join(".*?");
  const r1 = new RegExp(closeMatchRegex, "i");
  const r2 = new RegExp(distantMatchRegex, "i");
  let matches = [];
  if (!pattern) {
    return options;
  }
  for (let option of options) {
    let m = r1.exec(option.name);
    if (m) {
      matches.push({
        ...option,
        orderId: 100000 - (options.length - m[0].length - m.index),
      });
    } else {
      // Let's try the distant matcher
      var m2 = r2.exec(option.name);
      if (m2) {
        matches.push({
          ...option,
          orderId: 10000 - (options.length - m2[0].length - m2.index),
        });
      }
    }
  }
  return matches;
}

function simpleFilter(pattern: string, options: Option[]): Option[] {
  const lowerPattern = pattern.toLowerCase();
  return options.filter((option) => {
    return option.name.toLowerCase().includes(lowerPattern);
  });
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
  icon,
  newHint,
}: {
  placeholder: string;
  options: Option[];
  label: string;
  onKeyPress?: (key: string, currentText: string) => void;
  onSelect: (option: Option | undefined) => void;
  allowNew?: boolean;
  completePrefix?: string;
  helpText: string;
  newHint?: string;
  icon?: IconDefinition;
}) {
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [matchingOptions, setMatchingOptions] = useState(
    options.sort(magicSorter)
  );
  const [selectedOption, setSelectionOption] = useState(0);

  let selectedElementRef = useRef<HTMLDivElement>(null);

  function filterUpdate(e: React.ChangeEvent<HTMLInputElement>) {
    updateFilter(e.target.value);
  }

  function updateFilter(originalPhrase: string) {
    const searchPhrase = originalPhrase.toLowerCase();

    if (searchPhrase) {
      let foundExactMatch = false;
      let results = simpleFilter(searchPhrase, options);
      results = results.sort(magicSorter);
      if (allowNew && !foundExactMatch) {
        results.push({
          name: originalPhrase,
          hint: newHint,
        });
      }
      setMatchingOptions(results);
    } else {
      let results = options.sort(magicSorter);
      setMatchingOptions(results);
    }

    setText(originalPhrase);
    setSelectionOption(0);
  }

  useEffect(() => {
    updateFilter(text);
  }, [options]);

  useEffect(() => {
    searchBoxRef.current!.focus();
  }, []);

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
    <div className="filter-box">
      <div className="header">
        <label>{label}</label>
        <input
          type="text"
          value={text}
          placeholder={placeholder}
          ref={searchBoxRef}
          onChange={filterUpdate}
          onKeyDown={(e: React.KeyboardEvent) => {
            // console.log("Key up", e);
            if (onKeyPress) {
              onKeyPress(e.key, text);
            }
            switch (e.key) {
              case "ArrowUp":
                setSelectionOption(Math.max(0, selectedOption - 1));
                break;
              case "ArrowDown":
                setSelectionOption(
                  Math.min(matchingOptions.length - 1, selectedOption + 1)
                );
                break;
              case "Enter":
                onSelect(matchingOptions[selectedOption]);
                e.preventDefault();
                break;
              case "Escape":
                onSelect(undefined);
                break;
              case " ":
                if (completePrefix) {
                  setText(completePrefix);
                  e.preventDefault();
                }
                break;
            }
          }}
        />
      </div>
      <div
        className="help-text"
        dangerouslySetInnerHTML={{ __html: helpText }}
      ></div>
      <div className="result-list">
        {matchingOptions && matchingOptions.length > 0
          ? matchingOptions.map((option, idx) => (
              <div
                key={"" + idx}
                ref={selectedOption === idx ? selectedElementRef : undefined}
                className={
                  selectedOption === idx ? "selected-option" : "option"
                }
                onMouseOver={(e) => {
                  setSelectionOption(idx);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(option);
                }}
              >
                <span className="icon">
                  {icon && <FontAwesomeIcon icon={icon} />}
                </span>
                <span className="name">{option.name}</span>
                {option.hint && <span className="hint">{option.hint}</span>}
              </div>
            ))
          : null}
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
