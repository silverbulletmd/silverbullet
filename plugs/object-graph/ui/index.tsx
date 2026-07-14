import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { RootViewModel } from "../src/model.ts";
import { App } from "./components/app.tsx";
import { useEscape } from "./use_escape.ts";

declare const __GRAPH: RootViewModel;

function Root({ vm }: { vm: RootViewModel }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEscape();
  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  return (
    <div ref={rootRef} class="graph-root-inner" tabIndex={-1}>
      <App vm={vm} />
    </div>
  );
}

const root = document.getElementById("graph-root");
if (!root) throw new Error("graph-root not found");

// Focus the iframe document BEFORE rendering so the first keydown (often
// Escape) is delivered to us rather than the parent SilverBullet editor.
root.setAttribute("tabindex", "-1");
(root as HTMLElement).focus();

render(<Root vm={__GRAPH} />, root);
