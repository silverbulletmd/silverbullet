import { Check, Copy } from "preact-feather";
import { Button, type ButtonProps } from "./button.tsx";

export type CopyButtonProps = {
  copied: boolean;
  onClick: ButtonProps["onClick"];
};

export function CopyButton({ copied, onClick }: CopyButtonProps) {
  const label = copied ? "Copied" : "Copy";
  return (
    <Button
      variant="icon"
      class="sb-copy-button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
}
