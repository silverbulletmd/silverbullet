import { ViewPlugin, type EditorView } from "@codemirror/view";

const lines: string[] = [];
let t0 = Date.now();
function flush() {
  if (!lines.length) return;
  fetch("/.fs/dbg.txt", { method: "PUT", body: lines.join("\n") });
}


let timer: any;
export function dbg(msg: string) {
  lines.push(`${Date.now() - t0} ${msg}`);
  if (msg.includes("key=x") || msg.includes("key=Z")) {
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }
}

function domPos(view: EditorView, node: Node | null, off: number) {
  try {
    return node && view.contentDOM.contains(node) ? view.posAtDOM(node, off) : "out";
  } catch { return "err"; }
}

function state(view: EditorView) {
  const s = document.getSelection();
  return `cm=${view.state.selection.main.head} dom=${domPos(view, s?.focusNode ?? null, s?.focusOffset ?? 0)} doc=${JSON.stringify(view.state.doc.lineAt(view.state.selection.main.head).text)}`;
}

export const iosDebugPlugin = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {
    t0 = Date.now();
    dbg("init");
    for (const ev of ["touchstart", "touchend", "mousedown", "mouseup", "click", "keydown", "beforeinput", "input", "focusin", "focusout"]) {
      view.dom.addEventListener(ev, (e: any) => {
        if (!document.getElementById("sb-editor")?.contains(view.dom)) return;
        let extra = "";
        if (ev === "beforeinput") {
          const r = e.getTargetRanges?.()[0];
          extra = ` type=${e.inputType} data=${JSON.stringify(e.data)} target=${r ? domPos(view, r.startContainer, r.startOffset) + "-" + domPos(view, r.endContainer, r.endOffset) : "none"}`;
        }
        if (ev === "keydown") extra = ` key=${e.key}`;
        dbg(`${ev} tgt=${(e.target as Element).className ?? (e.target as Node).nodeName} dp=${e.defaultPrevented}${extra} ${state(view)}`);
      }, true);
    }
    document.addEventListener("selectionchange", () => document.getElementById("sb-editor")?.contains(view.dom) && dbg(`selectionchange ${state(view)}`));
  }
  update(u: any) {
    if (document.getElementById("sb-editor")?.contains(u.view.dom) && (u.docChanged || u.selectionSet)) dbg(`update ${u.transactions.map((t: any) => t.annotation?.(Symbol.for("x")) ?? "").join()} ${state(u.view)}`);
  }
});
