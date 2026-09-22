import { vi } from "vitest";

export class MediaTestElement extends EventTarget {
  readonly tagName: string;
  children: MediaTestElement[] = [];
  parentElement: MediaTestElement | null = null;
  style: Record<string, string> = {};
  textContent = "";
  hidden = false;
  tabIndex = -1;
  className = "";
  private classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  private attrs = new Map<string, string>();
  focus = vi.fn();
  pause = vi.fn();
  load = vi.fn();
  canPlayType = vi.fn(() => "");

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    for (const name of ["src", "alt", "title", "type", "data", "preload"]) {
      Object.defineProperty(this, name, {
        get: () => this.attrs.get(name) ?? "",
        set: (value: string) => this.attrs.set(name, value),
      });
    }
    for (const name of ["controls", "autoplay", "playsInline"]) {
      Object.defineProperty(this, name, {
        get: () => this.attrs.has(name.toLowerCase()),
        set: (value: boolean) => {
          if (value) this.attrs.set(name.toLowerCase(), "");
          else this.attrs.delete(name.toLowerCase());
        },
      });
    }
  }

  get attributes() {
    return Array.from(this.attrs, ([name, value]) => ({ name, value }));
  }

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string) {
    this.attrs.delete(name);
  }

  appendChild(child: MediaTestElement) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  append(...children: MediaTestElement[]) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children: MediaTestElement[]) {
    this.children.slice().forEach((child) => child.remove());
    this.append(...children);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
      this.parentElement = null;
    }
  }

  find(tag: string): MediaTestElement | undefined {
    return (
      this.children.find((child) => child.tagName === tag.toUpperCase()) ??
      this.children.map((child) => child.find(tag)).find(Boolean)
    );
  }
}

export function mediaTestDocument() {
  const parent = new MediaTestElement("div");
  return {
    parent,
    baseURI: "https://example.test/space/",
    createElement: (tag: string) => new MediaTestElement(tag),
    getElementById: () => parent,
  };
}
