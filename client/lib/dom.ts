export function parseHtmlString(html: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const wrapper = document.createElement("span");
  wrapper.className = "wrapper";
  while (doc.body.firstChild) {
    wrapper.appendChild(doc.body.firstChild);
  }
  return wrapper;
}

export function isDomNode(v: unknown): v is Node {
  return typeof Node !== "undefined" && v instanceof Node;
}
