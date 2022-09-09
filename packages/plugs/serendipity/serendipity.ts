import { listPages } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { navigate, prompt } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { dispatch } from "@plugos/plugos-syscall/event";
import { fullTextSearch } from "@plugos/plugos-syscall/fulltext";

export async function randomPage() {
    const pages = await listPages();
    const pageNames = pages.map(p => p.name);
  
    await navigate(
      pageNames[Math.floor(Math.random() * pageNames.length)]);
  }
  
  export async function randomPageWithTag() {
    const tagName = await prompt('Random page should include the following tag:');
  
    if (!tagName) {
      return;
    }
  
    let pages: Array<Array<any>> = await dispatch(
      'query:page',
      { query:  { table: 'page', filter: [{ op: '=', prop: 'tags', value: tagName }] }},
      10 * 1000
    );
  
    if (pages.length === 0) {
      return;
    }
  
    await navigate(pages[0].map(p => p.name)[Math.floor(Math.random() * pages.length)])
  }

  export async function randomPageFromSearch() {
    const searchTerm = await prompt('Random page should include the following search term:');
  
    if (!searchTerm) {
      return;
    }
  
    let results: Array<Array<any>> = await fullTextSearch(searchTerm);
  
    if (results.length === 0) {
      return;
    }
  
    await navigate(results[0].map(p => p.name)[Math.floor(Math.random() * results.length)])
  }
  