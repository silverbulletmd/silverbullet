import { Client } from "./client.ts";
import { EditorSelection } from "./deps.ts";

class PageState {
  constructor(
    readonly scrollTop: number,
    readonly selection: EditorSelection,
  ) {}
}

export class OpenPages {
  openPages = new Map<string, PageState>();

  constructor(private client: Client) {}

  restoreState(pageName: string): boolean {
    const pageState = this.openPages.get(pageName);
    const editorView = this.client.editorView;
    if (pageState) {
      // Restore state
      try {
        editorView.dispatch({
          selection: pageState.selection,
          // scrollIntoView: true,
        });
      } catch {
        // This is fine, just go to the top
        editorView.dispatch({
          selection: { anchor: 0 },
          scrollIntoView: true,
        });
      }
      setTimeout(() => {
        // Next tick, to allow the editor to process the render
        editorView.scrollDOM.scrollTop = pageState.scrollTop;
      });
    } else {
      editorView.scrollDOM.scrollTop = 0;
      editorView.dispatch({
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    }
    this.client.focus();
    return !!pageState;
  }

  saveState(currentPage: string) {
    this.openPages.set(
      currentPage,
      new PageState(
        this.client.editorView.scrollDOM.scrollTop,
        this.client.editorView.state.selection,
      ),
    );
  }
}
