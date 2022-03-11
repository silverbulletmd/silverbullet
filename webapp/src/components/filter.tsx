import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconDefinition } from "@fortawesome/free-solid-svg-icons";

export interface Option {
  name: string;
  orderId?: number;
  hint?: string;
}

function magicSorter(a: Option, b: Option): number {
  if (a.orderId && b.orderId) {
    return a.orderId < b.orderId ? -1 : 1;
  }
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

export function FilterList({
  placeholder,
  options,
  label,
  onSelect,
  onKeyPress,
  allowNew = false,
  helpText = "",
  icon,
  newHint,
}: {
  placeholder: string;
  options: Option[];
  label: string;
  onKeyPress?: (key: string, currentText: string) => void;
  onSelect: (option: Option | undefined) => void;
  allowNew?: boolean;
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

  const filter = (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalPhrase = e.target.value;
    const searchPhrase = originalPhrase.toLowerCase();

    if (searchPhrase) {
      let foundExactMatch = false;
      let results = options.filter((option) => {
        if (option.name.toLowerCase() === searchPhrase) {
          foundExactMatch = true;
        }
        return option.name.toLowerCase().indexOf(searchPhrase) !== -1;
      });
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
  };

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
          onChange={filter}
          onKeyDown={(e: React.KeyboardEvent) => {
            // console.log("Key up", e.key);
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
