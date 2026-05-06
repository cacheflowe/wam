const DB_NAME = "WamArrangementLibrary";
const STORE_NAME = "arrangements";
const DB_VERSION = 1;

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export default class WebAudioArrangementLibrary extends HTMLElement {
  constructor() {
    super();
    this._built = false;
  }

  connectedCallback() {
    if (!this._built) this._buildUI();
    this._refreshList();
  }

  _buildUI() {
    this._built = true;
    this.classList.add("wam-panel");
    this.style.cssText = `
      display: block;
      margin-bottom: 1.5rem;
      border: 1px solid #ffffff18;
      border-radius: 6px;
      padding: 1rem;
      background: #111116;
    `;

    const title = document.createElement("h3");
    title.textContent = "Arrangement Library";
    title.style.cssText = "margin: 0 0 1rem 0; font-size: 1rem; color: #bbc;";
    this.appendChild(title);

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap;";
    this.appendChild(toolbar);

    this._nameInput = document.createElement("input");
    this._nameInput.type = "text";
    this._nameInput.placeholder = "Song name...";
    this._nameInput.style.cssText =
      "flex: 1 1 200px; padding: 0.25rem 0.5rem; background: #000; color: #fff; border: 1px solid #334; border-radius: 4px;";
    toolbar.appendChild(this._nameInput);

    const mkBtn = (label, color) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `background: ${color}22; border: 1px solid ${color}66; color: ${color}; padding: 0.25rem 0.75rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem; white-space: nowrap;`;
      b.addEventListener("mouseover", () => (b.style.background = `${color}44`));
      b.addEventListener("mouseout", () => (b.style.background = `${color}22`));
      return b;
    };

    const saveBtn = mkBtn("Save Current", "#4f8");
    saveBtn.addEventListener("click", () => this._handleSave());
    toolbar.appendChild(saveBtn);

    const copyBtn = mkBtn("Copy JSON", "#a4f");
    copyBtn.addEventListener("click", () => this._handleCopyJSON());
    toolbar.appendChild(copyBtn);

    const pasteBtn = mkBtn("Paste JSON", "#fa4");
    pasteBtn.addEventListener("click", () => this._handlePasteJSON());
    toolbar.appendChild(pasteBtn);

    const exportBtn = mkBtn("Export .json", "#48f");
    exportBtn.addEventListener("click", () => this._handleExport());
    toolbar.appendChild(exportBtn);

    const importBtn = mkBtn("Import .json", "#f84");
    importBtn.addEventListener("click", () => this._fileInput.click());
    toolbar.appendChild(importBtn);

    this._fileInput = document.createElement("input");
    this._fileInput.type = "file";
    this._fileInput.accept = ".json";
    this._fileInput.style.display = "none";
    this._fileInput.addEventListener("change", (e) => this._handleImport(e));
    this.appendChild(this._fileInput);

    this._listContainer = document.createElement("div");
    this._listContainer.style.cssText = "display: flex; flex-direction: column; gap: 0.5rem;";
    this.appendChild(this._listContainer);
  }

  async _refreshList() {
    this._listContainer.innerHTML = "";

    let items = [];
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      items = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("Failed to load library items", e);
      return;
    }

    if (items.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.textContent = "No saved arrangements yet.";
      emptyMsg.style.cssText = "opacity: 0.4; font-style: italic; font-size: 0.85rem;";
      this._listContainer.appendChild(emptyMsg);
      return;
    }

    items.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      return b.timestamp - a.timestamp;
    });

    for (const item of items) {
      const row = document.createElement("div");
      row.draggable = true;
      row.dataset.id = item.id;
      row.style.cssText =
        "display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: #ffffff0a; border-radius: 4px; transition: border 0.2s;";

      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", item.id);
        row.style.opacity = "0.5";
      });
      row.addEventListener("dragend", () => {
        row.style.opacity = "1";
        this._listContainer.querySelectorAll("div").forEach((d) => {
          d.style.borderTop = "";
          d.style.borderBottom = "";
        });
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        const bounding = row.getBoundingClientRect();
        const offset = bounding.y + bounding.height / 2;
        if (e.clientY > offset) {
          row.style.borderBottom = "2px solid #4f8";
          row.style.borderTop = "";
        } else {
          row.style.borderTop = "2px solid #4f8";
          row.style.borderBottom = "";
        }
      });
      row.addEventListener("dragleave", (e) => {
        row.style.borderTop = "";
        row.style.borderBottom = "";
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.style.borderTop = "";
        row.style.borderBottom = "";
        const draggedId = e.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === item.id) return;

        const bounding = row.getBoundingClientRect();
        const offset = bounding.y + bounding.height / 2;
        const insertAfter = e.clientY > offset;

        await this._reorderItems(draggedId, item.id, insertAfter);
      });

      const leftSection = document.createElement("div");
      leftSection.style.cssText = "display: flex; align-items: center; gap: 0.75rem;";

      const dragHandle = document.createElement("div");
      dragHandle.textContent = "☰";
      dragHandle.style.cssText = "cursor: grab; opacity: 0.3; user-select: none; font-size: 1.2rem;";
      leftSection.appendChild(dragHandle);

      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.name || "Untitled";
      title.style.cssText = "display: block; margin-bottom: 0.1rem; color: #bbc;";
      const date = document.createElement("small");
      date.textContent = new Date(item.timestamp).toLocaleString();
      date.style.cssText = "color: #778;";
      info.appendChild(title);
      info.appendChild(date);
      leftSection.appendChild(info);
      row.appendChild(leftSection);

      const actions = document.createElement("div");
      actions.style.cssText = "display: flex; gap: 0.5rem;";

      const loadBtn = document.createElement("button");
      loadBtn.textContent = "Load";
      loadBtn.style.cssText =
        "background: transparent; border: 1px solid #4f8; color: #4f8; padding: 0.2rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.75rem;";
      loadBtn.addEventListener("click", () => this._fireLoad(item.state, item.name));
      actions.appendChild(loadBtn);

      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.style.cssText =
        "background: transparent; border: 1px solid #f44; color: #f44; padding: 0.2rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.75rem;";
      delBtn.addEventListener("click", () => this._handleDelete(item.id));
      actions.appendChild(delBtn);

      row.appendChild(actions);
      this._listContainer.appendChild(row);
    }
  }

  async _reorderItems(draggedId, targetId, insertAfter) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      const items = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });

      items.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        return b.timestamp - a.timestamp;
      });

      const draggedIdx = items.findIndex((i) => i.id === draggedId);
      const targetIdx = items.findIndex((i) => i.id === targetId);
      if (draggedIdx === -1 || targetIdx === -1) return;

      const [draggedItem] = items.splice(draggedIdx, 1);
      const newTargetIdx = items.findIndex((i) => i.id === targetId);
      items.splice(insertAfter ? newTargetIdx + 1 : newTargetIdx, 0, draggedItem);

      items.forEach((it, idx) => {
        it.order = idx;
        store.put(it);
      });

      tx.oncomplete = () => this._refreshList();
    } catch (e) {
      console.error("Reorder failed", e);
    }
  }

  _handleSave() {
    const name = this._nameInput.value.trim() || "Untitled Arrangement";
    this.dispatchEvent(
      new CustomEvent("arrangement-save", {
        detail: {
          name,
          callback: async (state) => {
            try {
              const db = await openDB();

              // Check for existing arrangement with the same name
              const readTx = db.transaction(STORE_NAME, "readonly");
              const readStore = readTx.objectStore(STORE_NAME);
              const items = await new Promise((resolve, reject) => {
                const req = readStore.getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });

              const existing = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
              let id = generateId();
              let order = undefined;

              if (existing) {
                if (!confirm(`An arrangement named "${existing.name}" already exists. Do you want to update it?`)) {
                  return; // Cancel save
                }
                id = existing.id; // Overwrite the existing entry
                order = existing.order;
              } else {
                const orders = items.map((i) => (i.order !== undefined ? i.order : 0));
                order = items.length > 0 ? Math.min(...orders) - 1 : 0;
              }

              const tx = db.transaction(STORE_NAME, "readwrite");
              const store = tx.objectStore(STORE_NAME);
              store.put({ id, order, name: existing ? existing.name : name, state, timestamp: Date.now() });
              tx.oncomplete = () => {
                this._refreshList();
              };
            } catch (e) {
              console.error("Failed to save", e);
            }
          },
        },
      }),
    );
  }

  async _handleDelete(id) {
    if (!confirm("Are you sure you want to delete this arrangement?")) return;
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => this._refreshList();
    } catch (e) {
      console.error("Failed to delete", e);
    }
  }

  _fireLoad(state, name) {
    if (name) this._nameInput.value = name;
    this.dispatchEvent(
      new CustomEvent("arrangement-load", {
        detail: { state, name },
      }),
    );
  }

  _handleExport() {
    this.dispatchEvent(
      new CustomEvent("arrangement-export", {
        detail: {
          callback: (state) => {
            const name = this._nameInput.value.trim() || "Wam_Arrangement";
            const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = `${name.replace(/\\W+/g, "_")}.json`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 100);
          },
        },
      }),
    );
  }

  _handleCopyJSON() {
    this.dispatchEvent(
      new CustomEvent("arrangement-export", {
        detail: {
          callback: (state) => {
            const jsonText = JSON.stringify(state, null, 2);
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(jsonText).then(
                () => alert("JSON copied to clipboard! You can paste it to a friend."),
                () => prompt("Copy this JSON:", jsonText),
              );
            } else {
              prompt("Copy this JSON:", jsonText);
            }
          },
        },
      }),
    );
  }

  async _handlePasteJSON() {
    let text = "";
    // Try reading gracefully from clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch (e) {
      // Permission denied or not supported; just fall through to the prompt
    }

    // Only prompt if we didn't automatically get JSON from the clipboard
    if (!text || !text.trim().startsWith("{")) {
      text = prompt("Paste your arrangement JSON here:");
    }

    if (!text || !text.trim()) return;

    try {
      const state = JSON.parse(text);
      const name = state.songName || "Pasted Arrangement";
      this._fireLoad(state, name);
    } catch (err) {
      alert("Failed to parse the pasted JSON. Ensure you copied the entire configuration correctly.");
    }
  }

  _handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target.result);
        const name = state.songName || file.name.replace(".json", "");
        this._fireLoad(state, name);
      } catch (err) {
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset
  }
}

if (!customElements.get("wam-arrangement-library")) {
  customElements.define("wam-arrangement-library", WebAudioArrangementLibrary);
}
