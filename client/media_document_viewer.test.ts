import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import { MediaDocumentViewer } from "./media_document_viewer.ts";
import { MediaTestElement, mediaTestDocument } from "./test_media_dom.ts";

const meta: DocumentMeta = {
  name: "Media/clip #1%.mp4",
  extension: "mp4",
  contentType: "video/mp4",
  lastModified: "2026-09-21T12:00:00Z",
  created: "",
  size: 100000000,
  perm: "ro",
  ref: "Media/clip #1%.mp4",
  tag: "document",
};
let doc: ReturnType<typeof mediaTestDocument>;
beforeEach(() => {
  doc = mediaTestDocument();
  vi.stubGlobal("document", doc);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const cm = new MediaTestElement("div");
  doc.parent.appendChild(cm);
  const client = { openUrl: vi.fn() };
  const viewer = new MediaDocumentViewer(
    doc.parent as unknown as HTMLElement,
    client as unknown as Client,
    { supports: () => true },
  );
  return { viewer, client, cm };
}

test("mounts URL-backed media, hides CodeMirror, and keeps an external action", () => {
  const { viewer, client, cm } = setup();
  viewer.openFile(undefined, meta, undefined);
  expect(viewer.needsBytes).toBe(false);
  expect(doc.parent.classList.contains("hide-cm")).toBe(true);
  expect(doc.parent.children).toContain(cm);
  expect(doc.parent.find("video")?.getAttribute("src")).toBe(
    "https://example.test/space/.fs/Media/clip%20%231%25.mp4?v=2026-09-21T12%3A00%3A00Z",
  );
  const button = doc.parent.find("button")!;
  expect(button.textContent).toBe("Open externally");
  button.dispatchEvent(new Event("click"));
  expect(client.openUrl).toHaveBeenCalledWith(
    "https://example.test/space/.fs/Media/clip%20%231%25.mp4?v=2026-09-21T12%3A00%3A00Z",
  );
  viewer.focus();
  expect(doc.parent.find("video")?.focus).toHaveBeenCalledOnce();
});

test("reload releases the old media and updates one mounted source", () => {
  const { viewer } = setup();
  viewer.openFile(undefined, meta, undefined);
  const old = doc.parent.find("video")!;
  viewer.openFile(undefined, { ...meta, lastModified: "next" }, undefined);
  expect(old.pause).toHaveBeenCalledOnce();
  expect(old.getAttribute("src")).toBeNull();
  expect(old.load).toHaveBeenCalledOnce();
  expect(doc.parent.children).toHaveLength(2);
  expect(doc.parent.find("video")?.getAttribute("src")).toContain("?v=next");
});

test.each([
  ["image/png", "img", "load"],
  ["application/pdf", "object", "load"],
  ["audio/mpeg", "audio", "loadedmetadata"],
  ["video/mp4", "video", "loadedmetadata"],
])("%s announces loading until the media is ready", (contentType, tag, readyEvent) => {
  const { viewer } = setup();
  viewer.openFile(undefined, { ...meta, contentType }, undefined);

  const status = doc.parent.find("p")!;
  expect(status.getAttribute("role")).toBe("status");
  expect(status.textContent).toBe("Loading document…");
  expect(status.hidden).toBe(false);

  doc.parent.find(tag)!.dispatchEvent(new Event(readyEvent));
  expect(status.hidden).toBe(true);
});

test.each([
  "image/png",
  "audio/mpeg",
  "video/mp4",
  "application/pdf",
])("%s errors retain an actionable fallback", (contentType) => {
  const { viewer } = setup();
  viewer.openFile(undefined, { ...meta, contentType }, undefined);
  const tag = {
    "image/png": "img",
    "audio/mpeg": "audio",
    "video/mp4": "video",
    "application/pdf": "object",
  }[contentType]!;
  doc.parent.find(tag)!.dispatchEvent(new Event("error"));
  expect(doc.parent.find("p")?.textContent).toBe(
    "This document could not be displayed.",
  );
  expect(doc.parent.find("p")?.hidden).toBe(false);
  expect(doc.parent.find("button")?.hidden).toBe(false);
  viewer.focus();
  expect(doc.parent.find("button")?.focus).toHaveBeenCalledOnce();
});

test("PDF always has external fallback and focuses it", () => {
  const { viewer } = setup();
  viewer.openFile(
    undefined,
    { ...meta, contentType: "application/pdf" },
    undefined,
  );
  expect(doc.parent.find("object")).toBeDefined();
  expect(doc.parent.find("button")?.hidden).toBe(false);
  viewer.focus();
  expect(doc.parent.find("button")?.focus).toHaveBeenCalledOnce();
});

test.each([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
])("host viewer rejects active content %s even with permissive capabilities", (contentType) => {
  const { viewer } = setup();
  viewer.openFile(undefined, { ...meta, contentType }, undefined);
  expect(doc.parent.find("img")).toBeUndefined();
  expect(doc.parent.find("object")).toBeUndefined();
  expect(doc.parent.find("iframe")).toBeUndefined();
  expect(doc.parent.find("p")?.hidden).toBe(false);
  expect(doc.parent.find("button")?.hidden).toBe(false);
});

test("errors from a released source cannot hide a reloaded document", () => {
  const { viewer } = setup();
  viewer.openFile(undefined, meta, undefined);
  const previous = doc.parent.find("video")!;
  viewer.openFile(undefined, { ...meta, lastModified: "next" }, undefined);
  previous.dispatchEvent(new Event("error"));
  expect(doc.parent.find("p")?.textContent).toBe("Loading document…");
  expect(doc.parent.find("p")?.hidden).toBe(false);
  expect(doc.parent.find("video")?.hidden).toBe(false);
});

test("ready events from a released source cannot clear a reloaded loading status", () => {
  const { viewer } = setup();
  viewer.openFile(undefined, meta, undefined);
  const previous = doc.parent.find("video")!;
  viewer.openFile(undefined, meta, undefined);

  previous.dispatchEvent(new Event("loadedmetadata"));
  const status = doc.parent.find("p")!;
  expect(status.textContent).toBe("Loading document…");
  expect(status.hidden).toBe(false);
});

test("a late ready event cannot clear an error from the current source", () => {
  const { viewer } = setup();
  viewer.openFile(undefined, meta, undefined);
  const media = doc.parent.find("video")!;

  media.dispatchEvent(new Event("error"));
  media.dispatchEvent(new Event("loadedmetadata"));

  const status = doc.parent.find("p")!;
  expect(status.textContent).toBe("This document could not be displayed.");
  expect(status.hidden).toBe(false);
  expect(media.hidden).toBe(true);
  expect(doc.parent.find("button")?.hidden).toBe(false);
});

test.each([
  "audio/mpeg",
  "video/mp4",
])("destroy releases %s and removes only owned DOM", async (contentType) => {
  const { viewer, cm } = setup();
  viewer.openFile(undefined, { ...meta, contentType }, undefined);
  const element = doc.parent.find(
    contentType.startsWith("audio") ? "audio" : "video",
  )!;
  await viewer.requestSave();
  viewer.updateTheme();
  viewer.destroy();
  expect(element.pause).toHaveBeenCalledOnce();
  expect(element.getAttribute("src")).toBeNull();
  expect(element.load).toHaveBeenCalledOnce();
  expect(doc.parent.children).toEqual([cm]);
  expect(doc.parent.classList.contains("hide-cm")).toBe(false);
  viewer.destroy();
  expect(element.pause).toHaveBeenCalledOnce();
});
