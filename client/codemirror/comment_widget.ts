import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { Client } from "../client.ts";
import { decoratorStateField, isCursorInRange } from "./util.ts";
import {
  type ParsedComment,
  parseCommentBlock,
} from "../../plug-api/lib/comments.ts";

export function buildReplyInsertion(
  raw: string,
  blockFrom: number,
  parsed: ParsedComment,
  author: string | undefined,
  date: string,
): { insertAt: number; text: string; cursorPos: number } {
  const last = parsed.thread[parsed.thread.length - 1];
  const prior = parsed.thread[parsed.thread.length - 2];
  const replyTo = last.author ?? prior?.addressee ?? last.addressee;
  // A reply always carries a signature, even without a configured author --
  // an unsigned reply is otherwise indistinguishable from a continuation of
  // the message before it (see the "a signature closes a message" rule in
  // plug-api/lib/comments.ts).
  const sig = author ? ` — ${author}, ${date}` : ` — ${date}`;
  // When nobody is addressed (no addressee to reply to and no author to
  // reply back to), the reply stays an unaddressed message line, same as
  // any other note-to-self. Generated lines are left-aligned (no indentation).
  const linePrefix = replyTo !== undefined ? `@${replyTo}: ` : "";
  const line = `${linePrefix}${sig}`;

  // A reply always makes the block multi-line, so the closing `-->` must
  // land on its own line. Insert right before the literal `-->`: if it's
  // already on its own line (e.g. a prior reply already relocated it),
  // just add the new line ahead of it; otherwise break it onto a fresh
  // line first. Either way, no leading indentation is introduced.
  const arrowIdx = raw.lastIndexOf("-->");
  const closerOnOwnLine = arrowIdx > 0 && raw[arrowIdx - 1] === "\n";
  const leadingNewline = closerOnOwnLine ? "" : "\n";
  const text = `${leadingNewline}${line}\n`;
  const insertAt = blockFrom + arrowIdx;
  return {
    insertAt,
    text,
    cursorPos: insertAt + leadingNewline.length + linePrefix.length,
  };
}

export function resolveRange(
  docText: string,
  range: [number, number],
): [number, number] {
  const from = range[0] > 0 && docText[range[0] - 1] === "\n"
    ? range[0] - 1
    : range[0];
  return [from, range[1]];
}

class CommentCardWidget extends WidgetType {
  constructor(
    readonly raw: string,
    readonly parsed: ParsedComment,
    readonly range: [number, number],
    readonly client: Client,
    readonly readOnly: boolean,
  ) {
    super();
  }

  toDOM() {
    // The widget's root element must not have vertical margins: CodeMirror
    // measures block heights with getBoundingClientRect(), which excludes
    // them, so any margin here desyncs the height map from the real layout
    // and corrupts coordinate-based cursor motion and selection drawing.
    // The gap around the card lives as padding on this wrapper instead.
    const wrapper = document.createElement("div");
    wrapper.className = "sb-comment-widget";
    const card = document.createElement("div");
    card.className = "sb-comment-card";
    wrapper.appendChild(card);
    if (this.parsed.quote) {
      const q = document.createElement("div");
      q.className = "sb-comment-quote";
      q.textContent = this.parsed.quote;
      card.appendChild(q);
    }
    for (const msg of this.parsed.thread) {
      const row = document.createElement("div");
      row.className = "sb-comment-message";
      if (msg.addressee) {
        const chip = document.createElement("span");
        chip.className = "sb-comment-addressee";
        chip.textContent = `@${msg.addressee}`;
        row.appendChild(chip);
      }
      const body = document.createElement("span");
      body.className = "sb-comment-text";
      body.textContent = msg.addressee ? ` ${msg.text}` : msg.text;
      row.appendChild(body);
      if (msg.author) {
        const sig = document.createElement("span");
        sig.className = "sb-comment-sig";
        sig.textContent = ` — ${msg.author}${msg.date ? `, ${msg.date}` : ""}`;
        row.appendChild(sig);
      }
      card.appendChild(row);
    }
    if (!this.readOnly) {
      const actions = document.createElement("div");
      actions.className = "sb-comment-actions";
      // Reply only makes sense on a thread that's addressed to somebody --
      // an unaddressed note has no one to reply to. buildReplyInsertion's
      // unaddressed fallback stays in place regardless, as a safeguard for
      // mixed threads (addressed earlier, unaddressed last message).
      if (this.parsed.addressees.length > 0) {
        actions.appendChild(this.button("Reply", () => this.reply()));
      }
      actions.appendChild(this.button("Resolve", () => this.resolve()));
      card.appendChild(actions);
    }
    wrapper.addEventListener("mousedown", (e) => {
      // Leave the Reply/Resolve buttons' own mousedown/click behavior alone.
      if ((e.target as HTMLElement).closest("button")) {
        return;
      }
      if (e.altKey) {
        // Move the document cursor into the block so it re-renders as raw
        // text, same convention as other Live Preview widgets (see
        // attachWidgetEventHandlers in widget_util.ts).
        this.client.editorView.dispatch({
          selection: { anchor: this.range[0] },
        });
        this.client.focus();
        e.preventDefault();
      }
      // CodeMirror overrides mousedown on parent elements to implement its
      // own selection highlighting; don't let that hijack clicks on the card.
      e.stopPropagation();
    });
    return wrapper;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private reply() {
    const view = this.client.editorView;
    const author = this.client.config.get<string>("comments.author", "");
    const date = new Date().toISOString().slice(0, 10);
    const r = buildReplyInsertion(
      this.raw,
      this.range[0],
      this.parsed,
      author || undefined,
      date,
    );
    view.dispatch({
      changes: { from: r.insertAt, insert: r.text },
      selection: { anchor: r.cursorPos },
    });
    view.focus();
  }

  private resolve() {
    const view = this.client.editorView;
    const [from, to] = resolveRange(
      view.state.doc.toString(),
      this.range,
    );
    view.dispatch({ changes: { from, to, insert: "" } });
  }

  override eq(other: CommentCardWidget) {
    return other.raw === this.raw && other.range[0] === this.range[0];
  }
}

export function commentPlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "CommentBlock") {
          return;
        }
        const range: [number, number] = [node.from, node.to];
        if (isCursorInRange(state, range)) {
          return;
        }
        const raw = state.sliceDoc(node.from, node.to);
        const parsed = parseCommentBlock(raw);
        if (!parsed) {
          return;
        }
        widgets.push(
          Decoration.replace({
            widget: new CommentCardWidget(
              raw,
              parsed,
              range,
              client,
              state.readOnly,
            ),
            block: true,
          }).range(range[0], range[1]),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
