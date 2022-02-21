import React, { useEffect, useRef, useState } from "react";

type Option = {
  name: string;
  hint?: string;
};

export function FilterList({
  initialText,
  options,
  onSelect,
  allowNew = false,
}: {
  initialText: string;
  options: Option[];
  onSelect: (option: Option | undefined) => void;
  allowNew?: boolean;
}) {
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [matchingOptions, setMatchingOptions] = useState(options);
  const [selectedOption, setSelectionOption] = useState(0);

  const filter = (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalPhrase = e.target.value;
    const searchPhrase = originalPhrase.toLowerCase();

    if (searchPhrase) {
      let results = options.filter((option) => {
        return option.name.toLowerCase().indexOf(searchPhrase) !== -1;
      });
      results.splice(0, 0, {
        name: originalPhrase,
        hint: "Create new",
      });
      setMatchingOptions(results);
    } else {
      setMatchingOptions(options);
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
      console.log("Unsubscribing");
      document.removeEventListener("click", closer);
    };
  }, []);

  return (
    <div className="filter-container">
      <input
        type="text"
        value={text}
        ref={searchBoxRef}
        onChange={filter}
        onKeyDown={(e: React.KeyboardEvent) => {
          console.log("Key up", e.key);
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
        className="input"
        placeholder=""
      />

      <div className="result-list">
        {matchingOptions && matchingOptions.length > 0
          ? matchingOptions.map((option, idx) => (
              <div
                key={"" + idx}
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
                <span className="user-name">{option.name}</span>
                {option.hint && <span className="hint">{option.hint}</span>}
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
