import React, { useEffect, useRef, useState } from "react";

type Option = {
  name: string;
};

export function FilterList({
  initialText,
  options,
  onSelect,
}: {
  initialText: string;
  options: Option[];
  onSelect: (option: Option) => void;
}) {
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [matchingOptions, setMatchingOptions] = useState(options);
  const [selectedOption, setSelectionOption] = useState(0);

  const filter = (e: React.ChangeEvent<HTMLInputElement>) => {
    const keyword = e.target.value.toLowerCase();

    if (keyword) {
      const results = options.filter((option) => {
        return option.name.toLowerCase().indexOf(keyword) !== -1;
      });
      setMatchingOptions(results);
    } else {
      setMatchingOptions(options);
    }

    setText(keyword);
    setSelectionOption(0);
  };

  useEffect(() => {
    searchBoxRef.current!.focus();
  }, []);

  return (
    <div className="filter-container">
      <input
        type="search"
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
          }
        }}
        className="input"
        placeholder="Filter"
      />

      <div className="result-list">
        {matchingOptions && matchingOptions.length > 0 ? (
          matchingOptions.map((option, idx) => (
            <li
              key={"" + idx}
              className={selectedOption === idx ? "selected-option" : "option"}
              onMouseOver={(e) => {
                setSelectionOption(idx);
              }}
              onClick={(e) => {
                onSelect(option);
                e.preventDefault();
              }}
            >
              <span className="user-name">{option.name}</span>
            </li>
          ))
        ) : (
          <h1>No results found!</h1>
        )}
      </div>
    </div>
  );
}
