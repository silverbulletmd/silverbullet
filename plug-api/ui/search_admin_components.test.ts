import { expect, test } from "vitest";
import { h } from "preact";
import { render } from "preact-render-to-string";
import {
  SearchBadge,
  SearchIndexStatus,
  SearchModelPicker,
  SearchSpacesTable,
  SearchSummary,
} from "./index.ts";
import type {
  IndexReport,
  SearchModelState,
  SpaceSearchSummary,
} from "../types/search_admin.ts";

const e5 = {
  id: "multilingual-e5-small",
  displayName: "Multilingual E5 Small",
  languages: "Multilingual (about 100 languages)",
  downloadBytes: 487_724_985,
  residentBytes: 588_302_000,
  license: "MIT",
  homepage: "https://huggingface.co/intfloat/multilingual-e5-small",
  notice: "",
};
const ready = (over: Partial<IndexReport> = {}): IndexReport =>
  ({
    kind: "fullText",
    state: "ready",
    catchUp: null,
    pages: 2950,
    bytes: 41_000_000,
    memory: false,
    buildSecs: 4,
    ...over,
  }) as IndexReport;

test("the picker shows the model card, its download and stored models", () => {
  const model: SearchModelState = {
    model: e5.id,
    catalog: [e5],
    download: { state: "downloading", done: 120_000_000, total: 487_724_985 },
    stored: [
      {
        id: e5.id,
        displayName: e5.displayName,
        bytes: 120_000_000,
        complete: false,
        active: true,
      },
    ],
  };
  const html = render(
    h(SearchModelPicker, {
      model,
      busy: false,
      onSelect: () => {},
      onRemove: () => {},
    }),
  );
  expect(html).toContain("None (full-text search only)");
  expect(html).toContain(
    'href="https://huggingface.co/intfloat/multilingual-e5-small"',
  );
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain("MIT");
  expect(html).toContain("Memory about 590 MB");
  expect(html).toContain("120 MB of 488 MB");
  expect(html).toContain("Cancel download");
  expect(html).toContain("partial download");
  expect(html).toContain('role="progressbar"');
  expect(html).not.toContain(">Remove<");
});

test("the picker lists the offered models in catalog order", () => {
  const granite = {
    id: "granite-embedding-97m-multilingual-r2",
    displayName: "Granite Embedding 97M Multilingual R2",
    languages:
      "Multilingual (52 languages with retrieval training, 200+ pretrained)",
    downloadBytes: 220_192_456,
    residentBytes: 487_223_920,
    license: "Apache-2.0",
    homepage:
      "https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2",
    notice:
      "ibm-granite/granite-embedding-97m-multilingual-r2 by IBM, Apache-2.0 license.",
  };
  const model: SearchModelState = {
    model: granite.id,
    catalog: [granite, e5],
    download: { state: "ready" },
    stored: [],
  };
  const html = render(
    h(SearchModelPicker, {
      model,
      busy: false,
      onSelect: () => {},
      onRemove: () => {},
    }),
  );
  const first = html.indexOf(">Granite Embedding 97M Multilingual R2<");
  const second = html.indexOf(">Multilingual E5 Small<");
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
  expect(html).toContain("Download 220 MB · Memory about 490 MB");
  expect(html).toContain("License: Apache-2.0");
  expect(html).toContain("by IBM, Apache-2.0 license.");
});

test("a stored model not in use can be removed", () => {
  const model: SearchModelState = {
    model: null,
    catalog: [e5],
    download: null,
    stored: [
      {
        id: e5.id,
        displayName: e5.displayName,
        bytes: 487_724_985,
        complete: true,
        active: false,
      },
    ],
  };
  const html = render(
    h(SearchModelPicker, {
      model,
      busy: false,
      onSelect: () => {},
      onRemove: () => {},
    }),
  );
  expect(html).toContain(">Remove<");
  expect(html).not.toContain("Model page");
});

test("the status lists each index with a bar while it builds", () => {
  const html = render(
    h(SearchIndexStatus, {
      indexes: [
        ready(),
        {
          ...ready({ kind: "semantic" }),
          state: "building",
          done: 10,
          total: 40,
        } as IndexReport,
      ],
    }),
  );
  expect(html).toContain("Full-text index");
  expect(html).toContain("Semantic index");
  expect(html).toContain('role="status"');
  expect(html.match(/role="progressbar"/g)?.length).toBe(1);
});

test("the spaces table orders active spaces first, each status one word with its details in a tooltip", () => {
  const space = (over: Partial<SpaceSearchSummary>): SpaceSearchSummary => ({
    name: "Garden",
    semanticChoice: null,
    semantic: "on",
    pages: 2950,
    indexes: [ready(), ready({ kind: "semantic", bytes: 4_000_000 })],
    ...over,
  });
  const spaces: Record<string, SpaceSearchSummary> = {
    s3: space({
      name: "Recipes",
      semanticChoice: false,
      semantic: "offByChoice",
      indexes: [ready()],
    }),
    s1: space({
      name: "Bikes",
      indexes: [
        ready(),
        { ...ready({ kind: "semantic" }), state: "waiting" } as IndexReport,
      ],
    }),
    s2: space({
      name: "Orchard",
      semantic: "offTooLarge",
      pages: 5001,
      indexes: [
        {
          ...ready(),
          state: "building",
          done: 115,
          total: 5001,
        } as IndexReport,
      ],
    }),
    s4: space({ name: "Garden" }),
    s5: space({
      name: "Attic",
      indexes: [
        ready({ catchUp: { done: 12, total: 40 } } as Partial<IndexReport>),
        {
          ...ready({ kind: "semantic" }),
          state: "failed",
          reason: "disk full",
        } as IndexReport,
      ],
    }),
  };
  const html = render(h(SearchSpacesTable, { spaces, onRebuild: () => {} }));
  expect(html.match(/<tr>/g)?.length).toBe(6);
  // Active (Attic, Bikes, Orchard), then the rest (Garden, Recipes), by name.
  const order = ["Attic", "Bikes", "Orchard", "Garden", "Recipes"].map((n) =>
    html.indexOf(`>${n}<`),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html).toContain('title="Building · 115 of 5,001 pages">Building');
  expect(html).toContain(">115/5,001<");
  expect(html).toContain('title="Waiting to build">Waiting<');
  expect(html).toContain(
    'title="Ready · catching up 12 of 40 pages">Catching up<',
  );
  expect(html).toContain('title="Failed: disk full">Failed<');
  expect(html).toContain('title="Ready · 2,950 pages · 41 MB">Ready<');
  expect(html).toContain('title="Off by choice">Off<');
  expect(html).toContain('title="Off: over 5,000 pages">Off<');
  // The cells carry no counts or sizes: the Pages and Size columns do.
  expect(html).not.toContain(">Ready ·");
  expect(html).toContain(">5,001<");
  expect(html).toContain(">45 MB<");
  expect(html.match(/role="progressbar"/g)?.length).toBe(1);
  // Rebuild sits in each row's menu.
  expect(html.match(/aria-haspopup="menu"/g)?.length).toBe(5);
  expect(html).toContain('aria-label="Actions for Garden"');
  expect(html).not.toContain(">Rebuild<");
  expect(html).not.toContain("Closed spaces");
});

test("the table shows closed spaces last as Closed, with a line under it", () => {
  const space = (over: Partial<SpaceSearchSummary>): SpaceSearchSummary => ({
    name: "Garden",
    semanticChoice: null,
    semantic: "on",
    pages: 120,
    indexes: [],
    ...over,
  });
  const spaces = {
    closed: space({ name: "Allotment" }),
    open: space({ name: "Bikes", indexes: [ready()] }),
  };
  const html = render(
    h(SearchSpacesTable<SpaceSearchSummary>, {
      spaces,
      onRebuild: () => {},
      closed: (s) => s.indexes.length === 0,
    }),
  );
  expect(html.indexOf(">Bikes<")).toBeLessThan(html.indexOf(">Allotment<"));
  expect(html).toContain('colspan="2" class="sb-search-spaces-muted">Closed<');
  expect(html.match(/>Closed</g)?.length).toBe(1);
  expect(html).toContain("Closed spaces show their status when opened.");
  expect(html).not.toContain("Open the space");
});

test("the summary line renders the shared text, and nothing without indexes", () => {
  const html = render(
    h(SearchSummary, {
      spaces: { a: { name: "Notes", indexes: [ready()] } },
    }),
  );
  expect(html).toContain('role="status"');
  expect(html).toContain("All indexes up to date");
  expect(
    render(h(SearchSummary, { spaces: { a: { name: "Notes", indexes: [] } } })),
  ).toBe("");
});

test("the space badge says a space indexes or failed, and nothing when ready", () => {
  const building = {
    ...ready(),
    state: "building",
    done: 1,
    total: 3,
  } as IndexReport;
  const failed = {
    ...ready(),
    state: "failed",
    reason: "disk full",
  } as IndexReport;
  expect(render(h(SearchBadge, { indexes: [ready(), building] }))).toContain(
    ">Indexing<",
  );
  expect(render(h(SearchBadge, { indexes: [failed, building] }))).toContain(
    ">Search failed<",
  );
  expect(render(h(SearchBadge, { indexes: [ready()] }))).toBe("");
  expect(render(h(SearchBadge, { indexes: [] }))).toBe("");
});
