// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  buildTestEnv,
  renderCorpusHtml,
  renderCorpusLive,
} from "./compose_test_env.ts";

// Re-serialise through one DOM so attribute quoting and entities match.
function normaliseHtml(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.innerHTML;
}

const INC =
  "Included ${query[[from p = T.pages select templates.pageItem(p)]]}";

// Output captured from the renderer before slot rendering existed; both the
// static and the live path must keep producing it.
const CORPUS: Record<string, [markdown: string, html: string]> = {
  "page-item-select": [
    "${query[[from p = T.pages select templates.pageItem(p)]]}",
    '<span class="p"><ul><li><span class="p"><a href="/Alpha" class="wiki-link" data-ref="Alpha">Alpha</a></span></li><li><span class="p"><a href="/Beta/Gamma" class="wiki-link" data-ref="Beta/Gamma">Gamma</a></span></li></ul></span>',
  ],
  "full-page-item-select": [
    "${query[[from p = T.pages select templates.fullPageItem(p)]]}",
    '<span class="p"><ul><li><span class="p"><a href="/Alpha" class="wiki-link" data-ref="Alpha">Alpha</a></span></li><li><span class="p"><a href="/Beta/Gamma" class="wiki-link" data-ref="Beta/Gamma">Beta/Gamma</a></span></li></ul></span>',
  ],
  "task-item-select": [
    "${query[[from t = T.tasks select templates.taskItem(t)]]}",
    '<span class="p"><ul><li><span class="sb-task" data-external-task-ref="Alpha@10"><input type="checkbox" data-state=" "> <a href="/Alpha%4010" class="wiki-link" data-ref="Alpha@10">Alpha@10</a> Write</span></li><li><span class="sb-task" data-external-task-ref="$anchorone"><input type="checkbox" checked="checked" data-state="x"> <a href="/%24anchorone" class="wiki-link" data-ref="$anchorone">$anchorone</a> Ship</span></li></ul></span>',
  ],
  "tag-item-select": [
    "${query[[from t = T.tags select templates.tagItem(t)]]}",
    '<span class="p"><ul><li><span class="p"><a href="/tag%3Awork" class="wiki-link" data-ref="tag:work">#work</a></span></li></ul></span>',
  ],
  "template-each": [
    "${template.each(T.pages, templates.pageItem)}",
    '<span class="p"><ul><li><span class="p"><a href="/Alpha" class="wiki-link" data-ref="Alpha">Alpha</a></span></li><li><span class="p"><a href="/Beta/Gamma" class="wiki-link" data-ref="Beta/Gamma">Gamma</a></span></li></ul></span>',
  ],
  "concat-sub-pages": [
    "${widget.markdown(table.concat(query[[from p = T.pages select templates.pageItem(p)]]))}",
    '<span class="p"><ul><li><span class="p"><a href="/Alpha" class="wiki-link" data-ref="Alpha">Alpha</a></span></li><li><span class="p"><a href="/Beta/Gamma" class="wiki-link" data-ref="Beta/Gamma">Gamma</a></span></li></ul></span>',
  ],
  "mention-template": [
    '${T.mention({page = "Alpha", start = 3, snippet = "some *text*"})}',
    '<span class="p"><span class="p"><strong><a href="/Alpha%403" class="wiki-link" data-ref="Alpha@3">Alpha@3</a></strong>:<br/>some <em>text</em></span></span>',
  ],
  "docs-section": [
    '${T.docsSection({name = "Alpha", description = "First **page**"})}',
    '<span class="p"><h2><a href="/Alpha" class="wiki-link" data-ref="Alpha">Alpha</a></h2><span class="p">First <strong>page</strong></span></span>',
  ],
  "interpolate-string": [
    '${spacelua.interpolate("Hello ${who}!", {who = "World"})}',
    '<span class="p"><span class="p">Hello World!</span></span>',
  ],
  "transclusion-with-query": [
    "Before\n\n![[Inc]]\n\nAfter",
    '<span class="p">Before</span><br/><br/><span class="p"><span class="p">Included <ul><li><span class="p"><a href="/Alpha" class="wiki-link" data-ref="Alpha">Alpha</a></span></li><li><span class="p"><a href="/Beta/Gamma" class="wiki-link" data-ref="Beta/Gamma">Gamma</a></span></li></ul></span></span><br/><br/><span class="p">After</span>',
  ],
  "directive-in-table": [
    "| a | ${1+1} |\n|--|--|\n| b | ${'**x**'} |",
    '<table><thead><tr><td>a</td><td><span class="p">2</span></td></tr></thead><tr><td>b</td><td><span class="p"><strong>x</strong></span></td></tr></table>',
  ],
  "string-list-in-paragraph": [
    "Before ${'* a\\n* b'} after",
    '<span class="p">Before <ul><li><span class="p">a</span></li><li><span class="p">b</span></li></ul> after</span>',
  ],
  "records-table": [
    "${T.records}",
    '<span class="p"><table><thead><tr><th>name</th><th>n</th></tr></thead><tbody><tr><td data-table-cell-type="string">a</td><td data-table-cell-type="number">1</td></tr><tr><td data-table-cell-type="string">b</td><td data-table-cell-type="number">2</td></tr></tbody></table></span>',
  ],
  "scalar-list": [
    "${{1, 2, 3}}",
    '<span class="p"><span class="p">1<br/>2<br/>3</span></span>',
  ],
  "inline-scalars": [
    "Sum ${1+2} and ${'**bold**'} end",
    '<span class="p">Sum <span class="p">3</span> and <span class="p"><strong>bold</strong></span> end</span>',
  ],
};

for (const [name, [markdown, expected]] of Object.entries(CORPUS)) {
  test(`corpus: ${name}`, async () => {
    const env = await buildTestEnv({ Inc: INC });
    const html = await renderCorpusHtml(env, markdown);
    expect(html).toBe(expected);
    const liveHtml = await renderCorpusLive(env, markdown);
    expect(normaliseHtml(liveHtml)).toBe(normaliseHtml(html));
  });
}
