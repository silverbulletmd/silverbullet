import { useEffect, useState } from "preact/hooks";

/**
 * A text field that hands its value over when it is left or Enter is
 * pressed, since each hand-over saves; Escape puts the value back.
 */
export function CommitInput({
  className,
  label,
  placeholder,
  value,
  disabled,
  onCommit,
}: {
  className: string;
  label: string;
  placeholder?: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      disabled={disabled}
      onInput={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setText(value);
          // Left once it's back, so the blur hands nothing over
          const el = e.currentTarget;
          requestAnimationFrame(() => el.blur());
        }
      }}
    />
  );
}
