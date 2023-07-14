import { EditorSelection, EditorView } from "./deps.ts";

class PageState {
  constructor(
    readonly scrollTop: number,
    readonly selection: EditorSelection,
  ) {}
}

export class OpenPages {
  openPages = new Map<string, PageState>();

  constructor(private editorView: EditorView) {}

  restoreState(pageName: string): boolean {
    const pageState = this.openPages.get(pageName);
    const editorView = this.editorView;
    if (pageState) {
      // Restore state
      editorView.scrollDOM.scrollTop = pageState!.scrollTop;
      try {
        editorView.dispatch({
          selection: pageState.selection,
          scrollIntoView: true,
        });
      } catch {
        // This is fine, just go to the top
        editorView.dispatch({
          selection: { anchor: 0 },
          scrollIntoView: true,
        });
      }
    } else {
      editorView.scrollDOM.scrollTop = 0;
      editorView.dispatch({
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    }
    editorView.focus();
    return !!pageState;
  }

  saveState(currentPage: string) {
    this.openPages.set(
      currentPage,
      new PageState(
        this.editorView!.scrollDOM.scrollTop,
        this.editorView!.state.selection,
      ),
    );
  }
}
