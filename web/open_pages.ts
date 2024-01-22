import { PageRef } from "$sb/lib/page.ts";
import { Client } from "./client.ts";

export type PageState = PageRef & {
  scrollTop: number;
  selection: {
    anchor: number;
    head?: number;
  };
};

export function extractPageState(client: Client): PageState {
  const mainSelection = client.editorView.state.selection.main;
  return {
    page: client.currentPage!,
    scrollTop: client.editorView.scrollDOM.scrollTop,
    selection: {
      head: mainSelection.head,
      anchor: mainSelection.anchor,
    },
  };
}

export class OpenPages {
  openPages = new Map<string, PageState>();

  constructor(private client: Client) {}

  restoreState(pageName: string): boolean {
    const pageState = this.openPages.get(pageName);
    const editorView = this.client.editorView;
    console.log("Restoring state", pageState);
    if (pageState) {
      // Restore state
      try {
        editorView.dispatch({
          selection: pageState.selection,
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
    console.log("Focusing editor");
    this.client.focus();
    return !!pageState;
  }

  saveState(currentPage: string) {
    console.log(
      "Saving state for",
      currentPage,
      extractPageState(this.client),
    );
    this.openPages.set(
      currentPage,
      extractPageState(this.client),
    );
  }
}
