const SCHEMAS = /*INJECT:SCHEMAS*/null;
const VALUES = /*INJECT:VALUES*/null;
const COMMANDS = /*INJECT:COMMANDS*/null;
const COMMAND_OVERRIDES = /*INJECT:COMMAND_OVERRIDES*/null;
const CONFIG_OVERRIDES = /*INJECT:CONFIG_OVERRIDES*/null;
const IS_MAC = /*INJECT:IS_MAC*/false;

const currentConfig = {};
const pendingShortcuts = {};

const modifiedConfigPaths = new Set(Object.keys(CONFIG_OVERRIDES || {}));

for (const [name, override] of Object.entries(COMMAND_OVERRIDES || {})) {
  pendingShortcuts[name] = { ...override };
}
let activeTab = "configuration";
let recordingCell = null;
let categoryMap = {};

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function collectUiSchemas(schemaNode, path, results) {
  if (!schemaNode || !schemaNode.properties) return;
  for (const [key, prop] of Object.entries(schemaNode.properties)) {
    const fullPath = path ? path + "." + key : key;
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
    if (!current || !current.properties || !current.properties[part]) return undefined;
    current = current.properties[part];
  }
  return current;
}


function buildCategories() {
  const items = [];
  collectUiSchemas(SCHEMAS, "", items);

  categoryMap = {};
  for (const item of items) {
    if (item.schema.type === "object" && item.schema.properties) {
      const hasChildUi = Object.values(item.schema.properties).some(p => p.ui);
      if (hasChildUi) continue;
    }
    const cat = item.schema.ui.category;
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(item);

    currentConfig[item.path] = getValueAtPath(VALUES, item.path);
  }

  for (const fields of Object.values(categoryMap)) {
    fields.sort((a, b) => (a.schema.ui.order || 0) - (b.schema.ui.order || 0));
  }
}

function renderConfigurationTab() {
  let html = '<input type="text" id="cfg-config-search" placeholder="Search settings...">';
  for (const category of Object.keys(categoryMap).sort()) {
    const fields = categoryMap[category];
    if (!fields || fields.length === 0) continue;
    html += '<div class="cfg-category" data-category="' + escapeHtml(category) + '">';
    html += '<h2 class="cfg-category-title">' + escapeHtml(category) + '</h2>';
    for (const field of fields) {
      html += renderField(field.path, field.schema);
    }
    html += '</div>';
  }
  return html;
}

function renderField(path, schema) {
  const currentValue = currentConfig[path];
  const label = schema.ui?.label || path;
  const description = schema.description || "";
  const searchText = (label + " " + description + " " + path).toLowerCase();
  let control = "";

  if (schema.type === "boolean") {
    const checked = currentValue ? "checked" : "";
    control = '<input type="checkbox" class="cfg-checkbox" data-path="' +
      escapeHtml(path) + '" ' + checked + '>';
  } else if (schema.type === "string" && schema.enum) {
    control = '<select data-path="' + escapeHtml(path) + '">';
    for (const opt of schema.enum) {
      const selected = opt === currentValue ? " selected" : "";
      control += '<option value="' + escapeHtml(opt) + '"' + selected + '>' + escapeHtml(opt) + '</option>';
    }
    control += '</select>';
  } else if (schema.type === "string" && schema.ui?.inputType === "password") {
    control = '<input type="password" data-path="' + escapeHtml(path) + '" value="' + escapeHtml(currentValue || "") + '">';
  } else if (schema.type === "string") {
    control = '<input type="text" data-path="' + escapeHtml(path) + '" value="' + escapeHtml(currentValue || "") + '">';
  } else if (schema.type === "number") {
    control = '<input type="number" data-path="' + escapeHtml(path) + '" value="' + escapeHtml(String(currentValue ?? "")) + '">';
  } else {
    control = '<span class="cfg-hint">Configure manually in CONFIG</span>';
  }

  const isModified = modifiedConfigPaths.has(path);
  const resetBtn = '<button class="cfg-field-reset' + (isModified ? '' : ' hidden') +
    '" data-path="' + escapeHtml(path) + '" title="Reset to default">Reset</button>';

  return '<div class="cfg-field" data-search="' + escapeHtml(searchText) + '">' +
    '<div class="cfg-field-info">' +
    '<div class="cfg-field-label">' + escapeHtml(label) + '</div>' +
    (description ? '<div class="cfg-field-description">' + escapeHtml(description) + '</div>' : '') +
    '</div>' +
    '<div class="cfg-field-control">' + control + resetBtn + '</div></div>';
}

function renderShortcutsTab() {
  let html = '<input type="text" id="cfg-shortcuts-search" placeholder="Search commands...">';
  html += '<table id="cfg-shortcuts-table"><thead><tr>';
  html += '<th>Command</th><th>' + (IS_MAC ? 'Shortcut' : 'Key Binding') + '</th><th></th>';
  html += '</tr></thead><tbody>';

  const sortedNames = Object.keys(COMMANDS).filter(name => !COMMANDS[name].hide).sort();

  for (const name of sortedNames) {
    const cmd = COMMANDS[name];
    const binding = IS_MAC ? (cmd.mac || cmd.key || "") : (cmd.key || "");
    const displayBinding = Array.isArray(binding) ? binding.join(" / ") : (binding || "");
    const isModified = name in pendingShortcuts;
    const pendingBinding = isModified
      ? (IS_MAC ? (pendingShortcuts[name].mac ?? displayBinding) : (pendingShortcuts[name].key ?? displayBinding))
      : displayBinding;

    html += '<tr class="' + (isModified ? 'modified' : '') + '" data-cmd="' + escapeHtml(name) + '">';
    html += '<td>' + escapeHtml(name) + '</td>';
    html += '<td><span class="cfg-shortcut-cell' + (isModified ? ' modified' : '') +
      '" data-cmd="' + escapeHtml(name) + '">' +
      (pendingBinding ? escapeHtml(pendingBinding) : '<span class="cfg-shortcut-empty">none</span>') +
      '</span></td>';
    html += '<td><button class="cfg-reset-btn" data-cmd="' + escapeHtml(name) + '">Reset</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function keyEventToNotation(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push(IS_MAC ? "Cmd" : "Meta");

  const key = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;

  const keyMap = {
    "ArrowUp": "ArrowUp", "ArrowDown": "ArrowDown", "ArrowLeft": "ArrowLeft", "ArrowRight": "ArrowRight",
    "Enter": "Enter", "Escape": "Escape", "Backspace": "Backspace", "Delete": "Delete",
    "Tab": "Tab", " ": "Space", "Home": "Home", "End": "End", "PageUp": "PageUp", "PageDown": "PageDown",
  };

  let keyName = keyMap[key] || key;
  if (keyName.length === 1) keyName = keyName.toLowerCase();
  parts.push(keyName);
  return parts.join("-");
}

function startRecording(cell) {
  if (recordingCell) stopRecording(recordingCell);
  recordingCell = cell;
  cell.classList.add("recording");
  cell.textContent = "Press a key combination...";

  cell._keyHandler = function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { stopRecording(cell); renderTab(); return; }
    if (e.key === "Backspace" || e.key === "Delete") {
      const cmdName = cell.dataset.cmd;
      if (!pendingShortcuts[cmdName]) pendingShortcuts[cmdName] = {};
      if (IS_MAC) { pendingShortcuts[cmdName].mac = ""; }
      else { pendingShortcuts[cmdName].key = ""; }
      stopRecording(cell);
      renderTab();
      return;
    }
    const notation = keyEventToNotation(e);
    if (!notation) return;
    const cmdName = cell.dataset.cmd;
    if (!pendingShortcuts[cmdName]) pendingShortcuts[cmdName] = {};
    if (IS_MAC) { pendingShortcuts[cmdName].mac = notation; }
    else { pendingShortcuts[cmdName].key = notation; }
    stopRecording(cell);
    renderTab();
  };
  document.addEventListener("keydown", cell._keyHandler, true);
}

function stopRecording(cell) {
  cell.classList.remove("recording");
  if (cell._keyHandler) {
    document.removeEventListener("keydown", cell._keyHandler, true);
    cell._keyHandler = null;
  }
  recordingCell = null;
}

function renderTab() {
  const content = document.getElementById("cfg-content");
  if (activeTab === "shortcuts") {
    content.innerHTML = renderShortcutsTab();
    attachShortcutListeners();
  } else {
    content.innerHTML = renderConfigurationTab();
    attachGeneralListeners();
  }
}

function attachGeneralListeners() {
  for (const input of document.querySelectorAll("[data-path]")) {
    const path = input.dataset.path;
    if (input.type === "checkbox") {
      input.addEventListener("change", () => { currentConfig[path] = input.checked; updateResetVisibility(path); });
    } else if (input.type === "number") {
      input.addEventListener("input", () => {
        currentConfig[path] = input.value === "" ? undefined : Number(input.value);
        updateResetVisibility(path);
      });
    } else {
      input.addEventListener("input", () => { currentConfig[path] = input.value; updateResetVisibility(path); });
    }
  }
  for (const btn of document.querySelectorAll(".cfg-field-reset")) {
    btn.addEventListener("click", () => {
      const path = btn.dataset.path;
      modifiedConfigPaths.delete(path);
      const schema = getSchemaAtPath(path);
      currentConfig[path] = schema?.default;
      renderTab();
    });
  }
  const search = document.getElementById("cfg-config-search");
  if (search) {
    search.addEventListener("input", () => {
      const query = search.value.toLowerCase().trim();
      for (const category of document.querySelectorAll(".cfg-category")) {
        let anyVisible = false;
        for (const field of category.querySelectorAll(".cfg-field")) {
          const matches = !query || (field.dataset.search || "").includes(query);
          field.style.display = matches ? "" : "none";
          if (matches) anyVisible = true;
        }
        category.style.display = anyVisible ? "" : "none";
      }
    });
  }
}

function updateResetVisibility(path) {
  const current = currentConfig[path];
  const schema = getSchemaAtPath(path);
  const schemaDefault = schema?.default;
  const normalizedDefault = (schema && schema.type === "boolean" && schemaDefault == null) ? false : schemaDefault;
  const normalizedCurrent = (schema && schema.type === "boolean" && current == null) ? false : current;

  const btn = document.querySelector('.cfg-field-reset[data-path="' + path + '"]');
  if (normalizedCurrent === normalizedDefault) {
    modifiedConfigPaths.delete(path);
    if (btn) btn.classList.add("hidden");
  } else {
    modifiedConfigPaths.add(path);
    if (btn) btn.classList.remove("hidden");
  }
}

function attachShortcutListeners() {
  for (const cell of document.querySelectorAll(".cfg-shortcut-cell")) {
    cell.addEventListener("click", () => startRecording(cell));
  }
  for (const btn of document.querySelectorAll(".cfg-reset-btn")) {
    btn.addEventListener("click", () => { delete pendingShortcuts[btn.dataset.cmd]; renderTab(); });
  }
  const search = document.getElementById("cfg-shortcuts-search");
  if (search) {
    search.addEventListener("input", () => {
      const query = search.value.toLowerCase();
      for (const row of document.querySelectorAll("#cfg-shortcuts-table tbody tr")) {
        row.style.display = (row.dataset.cmd?.toLowerCase() || "").includes(query) ? "" : "none";
      }
    });
  }
}

buildCategories();
const tabsContainer = document.getElementById("cfg-tabs");
const tabs = [
  { id: "configuration", label: "Configuration" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
];
for (const { id, label } of tabs) {
  const btn = document.createElement("button");
  btn.className = "cfg-tab";
  btn.dataset.tab = id;
  btn.textContent = label;
  if (id === activeTab) btn.classList.add("active");
  tabsContainer.appendChild(btn);
}

for (const tab of tabsContainer.querySelectorAll(".cfg-tab")) {
  tab.addEventListener("click", () => {
    tabsContainer.querySelector(".cfg-tab.active")?.classList.remove("active");
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    renderTab();
  });
}

document.getElementById("cfg-close").addEventListener("click", () => { syscall("editor.hidePanel", "modal"); });
document.getElementById("cfg-cancel").addEventListener("click", () => { syscall("editor.hidePanel", "modal"); });

document.getElementById("cfg-save").addEventListener("click", async () => {
  try {
    const allConfig = {};
    for (const path of modifiedConfigPaths) {
      const value = currentConfig[path];
      if (value === undefined) continue;
      allConfig[path] = value;
    }
    await syscall("system.invokeFunction", "configuration-manager.saveConfiguration", allConfig, pendingShortcuts);
    await syscall("editor.hidePanel", "modal");
    await syscall("editor.flashNotification", "Configuration saved");
  } catch (e) {
    console.error("Save failed:", e);
    await syscall("editor.flashNotification", "Failed to save: " + e.message, "error");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !recordingCell) { syscall("editor.hidePanel", "modal"); }
});

renderTab();
