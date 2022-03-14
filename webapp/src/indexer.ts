import { AppEventDispatcher, IndexEvent } from "./app_event";
import { Space } from "./space";

export class Indexer {
  space: Space;

  constructor(space: Space) {
    this.space = space;
  }

  async indexPage(
    appEventDispatcher: AppEventDispatcher,
    pageName: string,
    text: string,
    withFlush: boolean
  ) {
    if (withFlush) {
      await this.space.indexDeletePrefixForPage(pageName, "");
    }
    let indexEvent: IndexEvent = {
      name: pageName,
      text,
    };
    await appEventDispatcher.dispatchAppEvent("page:index", indexEvent);
    // await this.setPageIndexPageMeta(pageMeta.name, pageMeta);
  }

  async reindexSpace(space: Space, appEventDispatcher: AppEventDispatcher) {
    let allPages = await space.listPages();
    // TODO: Parallelize?
    for (let page of allPages) {
      await space.indexDeletePrefixForPage(page.name, "");
      let pageData = await space.readPage(page.name);
      await this.indexPage(appEventDispatcher, page.name, pageData.text, false);
    }
  }
}
