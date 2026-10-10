// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createRenderContext, renderMarkdown } from "./compose.ts";
import { buildTestEnv, testHost } from "./compose_test_env.ts";

type Expect = {
  text?: string;
  buttons?: number;
  selector?: string;
  noTable?: boolean;
};

const TABLE = (cell: string) => `x\n\n| id | v |\n|---|---|\n| r | ${cell} |`;

// Cases from the investigation pages (A–E) that don't need a space index.
const MATRIX: [string, string, Expect][] = [
  ["A1 paragraph", "v ${1+1}", { text: "v 2" }],
  ["A2 heading", "# h ${1+2}", { selector: "h1", text: "h 3" }],
  ["A3 list item", "* i ${1+3}", { selector: "li", text: "i 4" }],
  ["A4 list button", '* ${T.btn("A4")}', { buttons: 1 }],
  ["A6 quote", "> q ${1+6}", { selector: "blockquote", text: "q 7" }],
  ["A8 bold", "**${1+8}**", { selector: "strong", text: "9" }],
  ["A9 wiki alias", "[[Alpha|n=${1+9}]]", { selector: "a", text: "n=10" }],
  ["A10 attribute", "[k: ${1+10}]", { selector: ".sb-attribute", text: "11" }],
  ["A15 html block", '<div class="x">${1+15}</div>', { text: "16" }],
  ["A19 multi-line", "m ${\n  1 +\n  19\n} e", { text: "m 20 e" }],
  ["A23 transclusion button", "![[Other]]", { buttons: 1, noTable: true }],
  [
    "B1 scalar",
    TABLE("${1+1}"),
    { selector: "tbody td:last-child", text: "2" },
  ],
  ["B3 button", TABLE('${T.btn("B3")}'), { buttons: 1 }],
  ["B7 nested", TABLE('${T.md("in ${2+5}")}'), { text: "in 7" }],
  ["B9 pipe", TABLE('${"a|b"}'), { text: "a|b" }],
  ["B10 newline", TABLE('${"x\\ny"}'), { text: "x" }],
  ["B11 brace", TABLE('${"}"}'), { text: "}" }],
  ["B13 ctx", TABLE("${_CTX.currentPage.name}"), { text: "Host" }],
  ["B17 escaped pipe", TABLE('${"a\\|b"}'), { text: "a|b" }],
  [
    "B20 table from directive",
    "${T.md(\"| h |\\n|---|\\n| ${T.btn('B20')} |\")}",
    { buttons: 1 },
  ],
  ["C1 two levels", '${T.md("l2 ${1+1}")}', { text: "l2 2" }],
  [
    "C2 three levels",
    "${T.md(\"L2 ${T.md('L3 ${3+0}')}\")}",
    { text: "L2 L3 3" },
  ],
  [
    "C4 button in markdown",
    "${T.md(\"b ${T.btn('C4')} a\")}",
    { buttons: 1, noTable: true },
  ],
  [
    "C14 evaluate=false",
    '${widget.markdown("lit ${1+1}", {evaluate=false})}',
    { text: "lit ${1+1}" },
  ],
  [
    "D2 template with button",
    '${template.new[==[btn=${T.btn("D2")}]==]{}}',
    { buttons: 1, text: "btn=" },
  ],
  [
    "D5 widgets per row",
    "${query[[from r = T.records select T.btn(r.name)]]}",
    { buttons: 2, noTable: true },
  ],
  [
    "D6 widget field",
    "${query[[from r = T.records select {name=r.name, action=T.btn(r.name)}]]}",
    { buttons: 2 },
  ],
  [
    "D8 template with query (#1233)",
    "${template.new[==[${query[[from r = T.records select {name=r.name, n=r.n}]]}]==]()}",
    { selector: "table", text: "b" },
  ],
  [
    "D9 template with widget rows",
    "${template.new[==[${query[[from r = T.records select {name=r.name, go=T.btn(r.name)}]]}]==]()}",
    { buttons: 2 },
  ],
  ["D7 concat", '${"x " .. T.btn("D7")}', { buttons: 1, text: "x " }],
  [
    "E2 nested ctx",
    '${T.md("n=${_CTX.currentPage.name}")}',
    { text: "n=Host" },
  ],
  ["E4 brace in string", 'v ${"}"} w', { text: "v } w" }],
  ["E6 long string", "v ${[[a}b]]} w", { text: "v a}b w" }],
];

for (const [name, markdown, exp] of MATRIX) {
  test(`matrix: ${name}`, async () => {
    const t = await buildTestEnv({
      Other: 'Other ${1+100} ${T.btn("Other")}',
    });
    const ctx = createRenderContext(testHost(t), {
      hostPage: { name: "Host" },
    });
    const { node } = await renderMarkdown(markdown, ctx);
    const scope = exp.selector ? node.querySelector(exp.selector) : node;
    expect(scope, `selector ${exp.selector}`).toBeTruthy();
    if (exp.text) expect(scope!.textContent).toContain(exp.text);
    if (exp.buttons !== undefined) {
      expect(node.querySelectorAll("button")).toHaveLength(exp.buttons);
    }
    if (exp.noTable) expect(node.querySelector("table")).toBeNull();
    expect(node.textContent).not.toContain("_isWidget");
    expect(node.textContent).not.toContain("Error");
  });
}
