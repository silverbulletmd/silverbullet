import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { DeviceCode } from "../auth/device_flow.ts";
import { Button, ButtonLink, Input } from "@silverbulletmd/silverbullet/ui";

export function Prompt({
  message,
  defaultValue,
  password,
  callback,
}: {
  message: string;
  defaultValue?: string;
  password?: boolean;
  darkMode: boolean | undefined;
  callback: (value?: string) => void;
}) {
  const [text, setText] = useState(defaultValue || "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end); // caret at end of default value
    }
  }, []);
  const returnEl = (
    <AlwaysShownModal
      onCancel={() => {
        callback();
      }}
    >
      <div className="sb-prompt">
        <label>{message}</label>
        <Input
          inputRef={inputRef}
          class="sb-prompt-input"
          type={password ? "password" : "text"}
          autoComplete="off"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onConfirm={(value) => callback(value)}
          onExit={() => callback()}
        />
        <div className="sb-prompt-buttons">
          <Button
            shortcut="esc"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            shortcut="⏎"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(text);
            }}
          >
            Ok
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}

export function Confirm({
  message,
  destructive,
  callback,
}: {
  message: string;
  destructive?: boolean;
  callback: (value: boolean) => void;
}) {
  const okButtonRef = useRef<HTMLButtonElement>(null);
  setTimeout(() => {
    okButtonRef.current?.focus();
  });
  const returnEl = (
    <AlwaysShownModal
      onCancel={() => {
        callback(false);
      }}
    >
      <div className="sb-prompt">
        <label>{message}</label>
        <div className="sb-prompt-buttons">
          <Button
            shortcut="esc"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(false);
            }}
          >
            Cancel
          </Button>
          <Button
            buttonRef={okButtonRef}
            autofocus
            variant={destructive ? "danger" : "primary"}
            shortcut="⏎"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(true);
            }}
          >
            Ok
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}

export function DeviceCodeModal({
  code,
  onCancel,
}: {
  code: DeviceCode;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <AlwaysShownModal onCancel={onCancel}>
      <div className="sb-prompt">
        {code.verificationUriComplete ? (
          // The Open link carries the code, so there is nothing to type here;
          // the bare URL is for approving on another device
          <label>
            Click Open, approve the sign-in there, and check that it shows this
            code (on another device, go to{" "}
            <span className="sb-device-url">{code.verificationUri}</span> and
            enter it):
          </label>
        ) : (
          <label>
            Open <span className="sb-device-url">{code.verificationUri}</span>{" "}
            and enter this code:
          </label>
        )}
        <div className="sb-device-code">{code.userCode}</div>
        <div className="sb-prompt-buttons">
          <ButtonLink
            href={code.verificationUriComplete ?? code.verificationUri}
            target="_blank"
            rel="noopener"
          >
            Open
          </ButtonLink>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              navigator.clipboard?.writeText(code.userCode);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy code"}
          </Button>
          <Button
            shortcut="esc"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCancel();
            }}
          >
            Cancel
          </Button>
        </div>
        <div>Waiting for approval…</div>
      </div>
    </AlwaysShownModal>
  );
}

export function AlwaysShownModal({
  children,
  onCancel,
}: {
  children: ComponentChildren;
  onCancel?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      className="sb-modal-box"
      onCancel={(e: Event) => {
        e.preventDefault();
        onCancel?.();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
