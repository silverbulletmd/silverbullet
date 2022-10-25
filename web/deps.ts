export * from "../common/deps.ts";

export {
  Fragment,
  h,
  render as preactRender,
} from "https://esm.sh/preact@10.11.1";
export type { ComponentChildren } from "https://esm.sh/preact@10.11.1";
export {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "https://esm.sh/preact@10.11.1/hooks";

export { FontAwesomeIcon } from "https://esm.sh/@aduh95/preact-fontawesome@0.1.5?external=@fortawesome/fontawesome-common-types";
export { faPersonRunning } from "https://esm.sh/@fortawesome/free-solid-svg-icons@6.2.0";
export type { IconDefinition } from "https://esm.sh/@fortawesome/free-solid-svg-icons@6.2.0";

// Y collab
export * as Y from "yjs";
export {
  yCollab,
  yUndoManagerKeymap,
} from "https://esm.sh/y-codemirror.next@0.3.2?external=yjs,@codemirror/state,@codemirror/commands,@codemirror/history,@codemirror/view";
export { WebrtcProvider } from "https://esm.sh/y-webrtc@10.2.3";
export { WebsocketProvider } from "https://esm.sh/y-websocket@1.4.5";
