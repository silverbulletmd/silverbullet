// __CFG is prepended by configuration_html.ts as a single JSON object.
// `lit` is the global exposed by the vendored lit-html IIFE bundle.
const { html, render, nothing, repeat, classMap } = lit;

const {
  schemas: SCHEMAS,
  values: VALUES,
  categories: CATEGORIES,
  commands: COMMANDS,
  commandOverrides: COMMAND_OVERRIDES,
  configOverrides: CONFIG_OVERRIDES,
  isMac: IS_MAC,
} = __CFG;

// ---- Pure helpers --------------------------------------------------------

function collectUiSchemas(schemaNode, path, results) {
  if (!schemaNode || !schemaNode.properties) return;
  for (const [key, prop] of Object.entries(schemaNode.properties)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (prop.ui) {
      results.push({ path: fullPath, schema: prop });
    }
    if (prop.type === "object" && prop.properties) {
      collectUiSchemas(prop, fullPath, results);
    }
  }
}

function getValueAtPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function getSchemaAtPath(path) {
  const parts = path.split(".");
  let current = SCHEMAS;
  for (const part of parts) {
    if (!current || !current.properties || !current.properties[part]) {
      return undefined;
    }
    current = current.properties[part];
  }
  return current;
}

function buildCategoryMap() {
  const items = [];
  collectUiSchemas(SCHEMAS, "", items);

  const initialConfig = {};
  const map = {};
  for (const item of items) {
    if (item.schema.type === "object" && item.schema.properties) {
      const hasChildUi = Object.values(item.schema.properties).some((p) =>
        p.ui
      );
      if (hasChildUi) continue;
    }
    const cat = item.schema.ui.category;
    (map[cat] ||= []).push(item);
    initialConfig[item.path] = getValueAtPath(VALUES, item.path);
  }
  for (const fields of Object.values(map)) {
    fields.sort((a, b) => (a.schema.ui.order || 0) - (b.schema.ui.order || 0));
  }
  return { categoryMap: map, initialConfig };
}

const { categoryMap: CATEGORY_MAP, initialConfig: INITIAL_CONFIG } =
  buildCategoryMap();

const SORTED_CATEGORY_NAMES = (() => {
  const defaultOrder = Number.POSITIVE_INFINITY;
  return Object.keys(CATEGORY_MAP).sort((a, b) => {
    const oa = CATEGORIES?.[a]?.order ?? defaultOrder;
    const ob = CATEGORIES?.[b]?.order ?? defaultOrder;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
})();

const SORTED_COMMAND_NAMES = Object.keys(COMMANDS)
  .filter((name) => !COMMANDS[name].hide)
  .sort();

function keyEventToNotation(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push(IS_MAC ? "Cmd" : "Meta");

  const key = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;

  const keyMap = {
    "ArrowUp": "ArrowUp",
    "ArrowDown": "ArrowDown",
    "ArrowLeft": "ArrowLeft",
    "ArrowRight": "ArrowRight",
    "Enter": "Enter",
    "Escape": "Escape",
    "Backspace": "Backspace",
    "Delete": "Delete",
    "Tab": "Tab",
    " ": "Space",
    "Home": "Home",
    "End": "End",
    "PageUp": "PageUp",
    "PageDown": "PageDown",
  };

  let keyName = keyMap[key] || key;
  if (keyName.length === 1) keyName = keyName.toLowerCase();
  parts.push(keyName);
  return parts.join("-");
}

function commandBinding(name) {
  const cmd = COMMANDS[name];
  const raw = IS_MAC ? (cmd.mac || cmd.key || "") : (cmd.key || "");
  return Array.isArray(raw) ? raw.join(" / ") : (raw || "");
}

// ---- State + render loop -------------------------------------------------

let state = {
  tab: "configuration",
  pendingConfig: { ...INITIAL_CONFIG },
  pendingShortcuts: Object.fromEntries(
    Object.entries(COMMAND_OVERRIDES || {}).map(([k, v]) => [k, { ...v }]),
  ),
  modifiedConfigPaths: new Set(Object.keys(CONFIG_OVERRIDES || {})),
  search: "",
  shortcutSearch: "",
  recordingCmd: null,
  saving: false,
};

let renderQueued = false;
function setState(patch) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render(App(state), document.getElementById("cfg-root"));
  });
}

// ---- Field change handling ----------------------------------------------

function setField(path, value) {
  setState((s) => {
    const pendingConfig = { ...s.pendingConfig, [path]: value };
    const modified = new Set(s.modifiedConfigPaths);
    const schema = getSchemaAtPath(path);
    const def = schema?.default;
    const normDef = (schema?.type === "boolean" && def == null) ? false : def;
    const normCur = (schema?.type === "boolean" && value == null) ? false : value;
    if (normCur === normDef) modified.delete(path);
    else modified.add(path);
    return { ...s, pendingConfig, modifiedConfigPaths: modified };
  });
}

function resetField(path) {
  setState((s) => {
    const pendingConfig = { ...s.pendingConfig };
    const schema = getSchemaAtPath(path);
    pendingConfig[path] = schema?.default;
    const modified = new Set(s.modifiedConfigPaths);
    modified.delete(path);
    return { ...s, pendingConfig, modifiedConfigPaths: modified };
  });
}

// ---- Shortcut recording --------------------------------------------------

let activeKeyHandler = null;

function startRecording(name) {
  setState({ recordingCmd: name });
}

function stopRecording() {
  setState({ recordingCmd: null });
}

function setShortcut(name, notation) {
  setState((s) => {
    const pendingShortcuts = { ...s.pendingShortcuts };
    const entry = { ...(pendingShortcuts[name] || {}) };
    if (IS_MAC) entry.mac = notation;
    else entry.key = notation;
    pendingShortcuts[name] = entry;
    return { ...s, pendingShortcuts, recordingCmd: null };
  });
}

function resetShortcut(name) {
  setState((s) => {
    const pendingShortcuts = { ...s.pendingShortcuts };
    delete pendingShortcuts[name];
    return { ...s, pendingShortcuts };
  });
}

function syncRecordingHandler() {
  // Install/remove a document-level keydown listener that captures the next
  // keystroke for the currently-recording command.
  const recordingCmd = state.recordingCmd;
  if (recordingCmd && !activeKeyHandler) {
    activeKeyHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cmdName = state.recordingCmd;
      if (!cmdName) return;
      if (e.key === "Escape") {
        stopRecording();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        setShortcut(cmdName, "");
        return;
      }
      const notation = keyEventToNotation(e);
      if (!notation) return;
      setShortcut(cmdName, notation);
    };
    document.addEventListener("keydown", activeKeyHandler, true);
  } else if (!recordingCmd && activeKeyHandler) {
    document.removeEventListener("keydown", activeKeyHandler, true);
    activeKeyHandler = null;
  }
}

// ---- Save / cancel -------------------------------------------------------

async function save() {
  if (state.saving) return;
  setState({ saving: true });
  try {
    const allConfig = {};
    for (const path of state.modifiedConfigPaths) {
      const value = state.pendingConfig[path];
      if (value === undefined) continue;
      allConfig[path] = value;
    }
    await syscall(
      "system.invokeFunction",
      "configuration-manager.saveConfiguration",
      allConfig,
      state.pendingShortcuts,
    );
    await syscall("editor.hidePanel", "modal");
    await syscall("editor.flashNotification", "Configuration saved");
  } catch (e) {
    console.error("Save failed:", e);
    await syscall(
      "editor.flashNotification",
      `Failed to save: ${e.message}`,
      "error",
    );
    setState({ saving: false });
  }
}

function close() {
  syscall("editor.hidePanel", "modal");
}

// ---- Templates -----------------------------------------------------------

const TABS = [
  { id: "configuration", label: "Configuration" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
];

const Header = (s) => html`
  <div id="cfg-header">
    <h1>Configuration</h1>
    <button id="cfg-close" title="Close" @click=${close}>×</button>
    <div id="cfg-tabs">
      ${TABS.map((t) => html`
        <button
          class=${classMap({ "cfg-tab": true, active: s.tab === t.id })}
          @click=${() => setState({ tab: t.id })}
        >${t.label}</button>
      `)}
    </div>
  </div>
`;

const Footer = (s) => html`
  <div id="cfg-footer">
    <button
      class="cfg-btn"
      id="cfg-cancel"
      ?disabled=${s.saving}
      @click=${close}
    >
      Cancel
    </button>
    <button
      class="cfg-btn cfg-btn-primary"
      id="cfg-save"
      ?disabled=${s.saving}
      @click=${save}
    >
      ${s.saving
        ? html`<span class="cfg-spinner"></span>Saving…`
        : html`Save &amp; Apply`}
    </button>
  </div>
`;

function fieldMatches(path, schema, query) {
  if (!query) return true;
  const label = schema.ui?.label || path;
  const description = schema.description || "";
  return (`${label} ${description} ${path}`).toLowerCase().includes(query);
}

const Control = (path, schema, value) => {
  if (schema.type === "boolean") {
    return html`<input
      type="checkbox"
      class="cfg-checkbox"
      ?checked=${!!value}
      @change=${(e) => setField(path, e.target.checked)}
    >`;
  }
  if (schema.type === "string" && schema.enum) {
    return html`<select
      @change=${(e) => setField(path, e.target.value)}
    >
      ${schema.enum.map((opt) => html`
        <option value=${opt} ?selected=${opt === value}>${opt}</option>
      `)}
    </select>`;
  }
  if (schema.type === "string") {
    const inputType = schema.ui?.inputType === "password" ? "password" : "text";
    return html`<input
      type=${inputType}
      .value=${value ?? ""}
      @input=${(e) => setField(path, e.target.value)}
    >`;
  }
  if (schema.type === "number") {
    return html`<input
      type="number"
      .value=${value == null ? "" : String(value)}
      @input=${(e) =>
        setField(path, e.target.value === "" ? undefined : Number(e.target.value))}
    >`;
  }
  return html`<span class="cfg-hint">Configure manually in CONFIG</span>`;
};

const Field = (path, schema, value, modified) => html`
  <div class="cfg-field">
    <div class="cfg-field-info">
      <div class="cfg-field-label">${schema.ui?.label || path}</div>
      ${
  schema.description
    ? html`<div class="cfg-field-description">${schema.description}</div>`
    : nothing
}
    </div>
    <div class="cfg-field-control">
      ${Control(path, schema, value)}
      <button
        class=${classMap({
  "cfg-field-reset": true,
  hidden: !modified,
})}
        title="Reset to default"
        @click=${() => resetField(path)}
      >Reset</button>
    </div>
  </div>
`;

const Category = (name, fields, query, s) => {
  const visible = fields.filter((f) => fieldMatches(f.path, f.schema, query));
  if (visible.length === 0) return nothing;
  const description = CATEGORIES?.[name]?.description;
  return html`
    <div class="cfg-category">
      <h2 class="cfg-category-title">${name}</h2>
      ${
    description
      ? html`<div class="cfg-category-description">${description}</div>`
      : nothing
  }
      ${
    visible.map((f) =>
      Field(f.path, f.schema, s.pendingConfig[f.path], s.modifiedConfigPaths.has(f.path))
    )
  }
    </div>
  `;
};

const ConfigurationTab = (s) => {
  const query = s.search.toLowerCase().trim();
  return html`
    <input
      type="text"
      id="cfg-config-search"
      placeholder="Search settings..."
      .value=${s.search}
      @input=${(e) => setState({ search: e.target.value })}
    >
    ${
    SORTED_CATEGORY_NAMES.map((name) =>
      Category(name, CATEGORY_MAP[name], query, s)
    )
  }
  `;
};

const ShortcutRow = (name, s) => {
  const isModified = name in s.pendingShortcuts;
  const fallback = commandBinding(name);
  const pending = isModified
    ? (IS_MAC
      ? (s.pendingShortcuts[name].mac ?? fallback)
      : (s.pendingShortcuts[name].key ?? fallback))
    : fallback;
  const isRecording = s.recordingCmd === name;
  return html`
    <tr class=${classMap({ modified: isModified })}>
      <td>${name}</td>
      <td>
        <span
          class=${classMap({
    "cfg-shortcut-cell": true,
    modified: isModified,
    recording: isRecording,
  })}
          @click=${() => startRecording(name)}
        >
          ${
    isRecording
      ? "Press a key combination..."
      : (pending
        ? pending
        : html`<span class="cfg-shortcut-empty">none</span>`)
  }
        </span>
      </td>
      <td>
        <button
          class="cfg-reset-btn"
              @click=${() => resetShortcut(name)}
        >Reset</button>
      </td>
    </tr>
  `;
};

const ShortcutsTab = (s) => {
  const query = s.shortcutSearch.toLowerCase();
  const visible = SORTED_COMMAND_NAMES.filter((n) =>
    !query || n.toLowerCase().includes(query)
  );
  return html`
    <input
      type="text"
      id="cfg-shortcuts-search"
      placeholder="Search commands..."
      .value=${s.shortcutSearch}
      @input=${(e) => setState({ shortcutSearch: e.target.value })}
    >
    <table id="cfg-shortcuts-table">
      <thead>
        <tr>
          <th>Command</th>
          <th>${IS_MAC ? "Shortcut" : "Key Binding"}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${repeat(visible, (n) => n, (n) => ShortcutRow(n, s))}
      </tbody>
    </table>
  `;
};

const App = (s) => {
  // Side-effect: install/remove the keydown listener whenever recording state
  // changes. Doing this inside render keeps the listener tied to state.
  syncRecordingHandler();
  return html`
    ${Header(s)}
    <div id="cfg-content">
      ${s.tab === "configuration" ? ConfigurationTab(s) : ShortcutsTab(s)}
    </div>
    ${Footer(s)}
  `;
};

// ---- Initial mount + global keybindings ---------------------------------

const root = document.getElementById("cfg-root");

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !state.recordingCmd) {
    syscall("editor.hidePanel", "modal");
  }
});

render(App(state), root);
