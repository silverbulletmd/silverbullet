export * from "../common/deps.ts";

export { Fragment, h, render as preactRender } from "preact";
export type { ComponentChildren, FunctionalComponent } from "preact";
export {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "https://esm.sh/preact@10.11.1/hooks";

export {
  Book as BookIcon,
  Home as HomeIcon,
  RefreshCw as RefreshCwIcon,
  Terminal as TerminalIcon,
} from "https://esm.sh/preact-feather@4.2.1?external=preact";

// Vim mode
export {
  getCM as vimGetCm,
  Vim,
  vim,
} from "https://esm.sh/@replit/codemirror-vim@6.0.14?external=@codemirror/state,@codemirror/language,@codemirror/view,@codemirror/search,@codemirror/commands";
