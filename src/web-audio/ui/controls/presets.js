/**
 * Presets: the preset section (built-in + user presets, ◀ ▶, save / delete / export), preset application, and shared select builders.
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { MUTATE_AMOUNTS } from "../../global/sound-design.js";
import { canWritePresets, deletePresetFromRepo, presetParamDefs, presetTags, removePreset, savePresetToRepo, upsertPreset } from "../../global/presets.js";
import { createCtrl, createSection } from "../controls-factory.js";
import { quantize } from "../../global/param-schema.js";

export class PresetControls {
  // ---- Shared UI builders ----

  /** localStorage key for user presets scoped to this instrument class. */
  _userPresetsKey() {
    return `wam-user-presets-${this._instrument?.constructor.name ?? "unknown"}`;
  }
  /** Load user-saved presets from localStorage. */
  _loadUserPresets() {
    try {
      return JSON.parse(localStorage.getItem(this._userPresetsKey()) || "{}");
    } catch {
      return {};
    }
  }
  /** Save user presets object to localStorage. */
  _saveUserPresets(presets) {
    localStorage.setItem(this._userPresetsKey(), JSON.stringify(presets));
  }
  /** Capture current instrument params as a preset object (sound-shaping only). */
  _capturePresetParams() {
    const params = {};
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume" || def.param === "chance") continue;
      const val = this._instrument[def.param];
      if (val !== undefined) params[def.param] = val;
    }
    // Capture registered selects (e.g. oscType, shape)
    for (const [param] of Object.entries(this._selects)) {
      const val = this._instrument[param];
      if (val !== undefined) params[param] = val;
    }
    // Capture registered toggles
    for (const [param] of Object.entries(this._toggles)) {
      const val = this._instrument[param];
      if (val !== undefined) params[param] = val;
    }
    return params;
  }
  /**
   * Build the Presets section (dropdown + randomize + save + delete).
   * Automatically skipped if instrument has no PRESETS.
   */
  _buildPresetSection(controls, instrument) {
    const PresetsObj = instrument.constructor.PRESETS;
    if (!PresetsObj || Object.keys(PresetsObj).length === 0) return;

    const { el: presetEl, controls: presetCtrl } = createSection("Presets");

    // Dropdown with ◀ ▶ stepping
    const wrap = createCtrl("Preset", { tooltip: "Load a sound preset. ◀ ▶ step through them." });
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wam-select";
    this._refreshPresetOptions();

    const presetRow = document.createElement("div");
    presetRow.className = "wam-preset-row";
    presetRow.style.cssText = "display:flex;gap:.25rem;align-items:stretch;";
    const mkStep = (label, dir, title) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = "wam-action-btn wam-preset-step";
      b.title = title;
      b.style.cssText = "flex:0 0 auto;padding:0 .4rem;";
      b.addEventListener("click", () => this.stepPreset(dir));
      return b;
    };
    this._presetSelect.style.cssText = "flex:1 1 auto;min-width:0;";
    presetRow.append(mkStep("◀", -1, "Previous preset"), this._presetSelect, mkStep("▶", 1, "Next preset"));

    this._presetSelect.addEventListener("change", () => {
      this._recordSound(); // preset loads are undoable
      const name = this._presetSelect.value;
      const userPresets = this._loadUserPresets();
      if (userPresets[name]) {
        // User preset — apply directly
        for (const [key, val] of Object.entries(userPresets[name])) {
          if (key === "volume") continue;
          const prop = `_${key}`;
          if (prop in this._instrument) this._instrument[prop] = val;
          else if (key in this._instrument) this._instrument[key] = val;
        }
        if (this._instrument._rebake) this._instrument._rebake();
        this._syncSliders();
        this._syncExtraControls();
      } else {
        this.applyPreset(name);
      }
      this._emitChange();
    });
    wrap.appendChild(presetRow);
    presetCtrl.appendChild(wrap);

    // Action buttons row
    const actionWrap = createCtrl("Actions");

    // Randomize All
    const randBtn = document.createElement("button");
    randBtn.textContent = "\u2684 Rand";
    randBtn.className = "wam-action-btn";
    randBtn.title = "Randomize the sound within musically useful ranges";
    randBtn.addEventListener("click", () => {
      this._randomizeAllParams();
      this._emitChange();
    });
    actionWrap.appendChild(randBtn);

    // Mutate + Undo/Redo — need the engine-level param schema.
    if (this._paramSchema) {
      const mutateRow = document.createElement("div");
      mutateRow.className = "wam-mutate-row";
      mutateRow.style.cssText = "display:flex;gap:.25rem;align-items:stretch;";
      const mutateBtn = document.createElement("button");
      mutateBtn.textContent = "≈ Mutate";
      mutateBtn.className = "wam-action-btn";
      mutateBtn.title = "Nudge the current sound. Amount set by the selector.";
      this._mutateAmountSelect = document.createElement("select");
      this._mutateAmountSelect.className = "wam-select";
      this._mutateAmountSelect.title = "Mutation amount";
      for (const [name, amt] of Object.entries(MUTATE_AMOUNTS)) {
        const opt = document.createElement("option");
        opt.value = amt;
        opt.textContent = name[0].toUpperCase() + name.slice(1);
        if (name === "medium") opt.selected = true;
        this._mutateAmountSelect.appendChild(opt);
      }
      mutateBtn.addEventListener("click", () => this.mutate(parseFloat(this._mutateAmountSelect.value)));
      mutateRow.append(mutateBtn, this._mutateAmountSelect);
      actionWrap.appendChild(mutateRow);

      const histRow = document.createElement("div");
      histRow.style.cssText = "display:flex;gap:.25rem;";
      this._undoBtn = document.createElement("button");
      this._undoBtn.textContent = "↶ Undo";
      this._undoBtn.className = "wam-action-btn";
      this._undoBtn.title = "Undo the last randomize / mutate / preset load";
      this._undoBtn.addEventListener("click", () => this.undoSound());
      this._redoBtn = document.createElement("button");
      this._redoBtn.textContent = "↷ Redo";
      this._redoBtn.className = "wam-action-btn";
      this._redoBtn.title = "Redo";
      this._redoBtn.addEventListener("click", () => this.redoSound());
      histRow.append(this._undoBtn, this._redoBtn);
      actionWrap.appendChild(histRow);
      this._updateHistoryButtons();
    }

    // Save
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "\uD83D\uDCBE Save";
    saveBtn.className = "wam-action-btn";
    saveBtn.title = "Save the current sound as a preset. Under the dev server it is written to src/web-audio/presets/ in the repo.";
    saveBtn.addEventListener("click", () => this._saveCurrentAsPreset());
    actionWrap.appendChild(saveBtn);

    // Delete
    const delBtn = document.createElement("button");
    delBtn.textContent = "\uD83D\uDDD1 Del";
    delBtn.className = "wam-action-btn";
    delBtn.title = "Delete the selected preset (built-ins only under the dev server).";
    delBtn.addEventListener("click", () => this._deleteSelectedPreset());
    actionWrap.appendChild(delBtn);

    // Export All
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "\uD83D\uDCCB Export";
    exportBtn.className = "wam-action-btn";
    exportBtn.title = "Copy all user presets to clipboard as JSON";
    exportBtn.addEventListener("click", () => this._exportAllUserPresets());
    actionWrap.appendChild(exportBtn);

    presetCtrl.appendChild(actionWrap);
    controls.appendChild(presetEl);
  }
  /** Refresh the user-preset options in the dropdown (appended after built-ins). */
  _refreshUserPresetOptions() {
    if (!this._presetSelect) return;
    // Remove existing user options
    this._presetSelect.querySelectorAll("option[data-user]").forEach((o) => o.remove());
    const userPresets = this._loadUserPresets();
    const names = Object.keys(userPresets);
    if (names.length === 0) return;
    // Separator
    const sep = document.createElement("option");
    sep.disabled = true;
    sep.textContent = "── User ──";
    sep.setAttribute("data-user", "");
    this._presetSelect.appendChild(sep);
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      opt.setAttribute("data-user", "");
      this._presetSelect.appendChild(opt);
    }
  }
  /** Prompt for a name and save the current sound as a user preset. */
  /**
   * Rebuild the preset dropdown: built-ins (grouped by first tag when any
   * preset is tagged), then user presets. Keeps the current selection.
   */
  _refreshPresetOptions() {
    const select = this._presetSelect;
    if (!select) return;
    const prev = select.value;
    const Cls = this._instrument.constructor;
    const entries = Cls.PRESET_DATA?.presets ?? Object.keys(Cls.PRESETS ?? {}).map((name) => ({ name, tags: [] }));
    select.replaceChildren();
    const mkOpt = (name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/_/g, " ");
      return opt;
    };
    if (entries.some((e) => e.tags?.length)) {
      const groups = new Map();
      for (const e of entries) {
        const tag = e.tags?.[0] ?? "other";
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(e.name);
      }
      for (const [tag, names] of groups) {
        const og = document.createElement("optgroup");
        og.label = tag;
        for (const n of names) og.appendChild(mkOpt(n));
        select.appendChild(og);
      }
    } else {
      for (const e of entries) select.appendChild(mkOpt(e.name));
    }
    this._refreshUserPresetOptions();
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
  }
  /** Step to the previous (-1) / next (+1) preset, wrapping. Applies it like a dropdown change. */
  stepPreset(dir = 1) {
    const select = this._presetSelect;
    if (!select) return;
    const opts = [...select.options].filter((o) => !o.disabled);
    if (!opts.length) return;
    const i = opts.findIndex((o) => o.value === select.value);
    const next = opts[(i + dir + opts.length) % opts.length];
    select.value = next.value;
    select.dispatchEvent(new Event("change"));
  }
  /**
   * Capture the current sound as preset params: every sound (non-part) schema
   * param — so presets are complete and never leak values — plus the
   * instrument's output volume. Legacy instruments fall back to SLIDER_DEFS.
   */
  _captureSoundPreset() {
    const schema = this._paramSchema;
    let params;
    if (schema) {
      params = {};
      for (const def of presetParamDefs(schema)) {
        const v = this._instrument[def.param];
        if (v === undefined) continue;
        params[def.param] = (def.type ?? "number") === "number" && typeof v === "number" ? quantize(def, v) : v;
      }
    } else {
      params = this._capturePresetParams();
    }
    params.volume = Math.round((this._instrument.volume ?? 1) * 100) / 100;
    return params;
  }
  /**
   * Save the current sound. Under the dev server it's written straight into
   * the instrument's preset JSON in the repo; otherwise it's stored as a
   * localStorage user preset (and copied to the clipboard).
   */
  async _saveCurrentAsPreset() {
    const Cls = this._instrument.constructor;
    const current = this._presetSelect?.value ?? "";
    const name = prompt("Preset name:", current)?.trim();
    if (!name) return;
    const params = this._captureSoundPreset();

    if (canWritePresets() && Cls.PRESET_DATA) {
      const exists = !!Cls.PRESETS[name];
      if (exists && !confirm(`Overwrite preset "${name}" in the repo?`)) return;
      const tagInput = prompt("Tags (comma-separated, optional — e.g. bass, acid):", presetTags(Cls.PRESET_DATA, name).join(", "));
      if (tagInput === null) return;
      const tags = tagInput.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      try {
        await savePresetToRepo(Cls.PRESET_DATA.instrument, { name, tags, params });
        upsertPreset(Cls, { name, tags, params });
        this._refreshPresetOptions();
        this._presetSelect.value = name;
        console.log(`[WAM] Preset "${name}" written to src/web-audio/presets/${Cls.PRESET_DATA.instrument}.json`);
        return;
      } catch (err) {
        console.error(err);
        alert(`Couldn't write to the repo (${err.message}). Saving as a local user preset instead.`);
      }
    }
    this._saveUserPreset(name, params);
  }
  /** localStorage user preset (production builds, or when the repo write fails). */
  _saveUserPreset(name, params) {
    const key = name;
    const userPresets = this._loadUserPresets();
    userPresets[key] = params;
    this._saveUserPresets(userPresets);
    this._refreshUserPresetOptions();
    this._presetSelect.value = key;
    // Copy to clipboard for pasting into source
    const json = JSON.stringify(params, null, 2);
    navigator.clipboard.writeText(`"${key}": ${json},`).then(() => {
      console.log(`[WAM] Preset "${key}" saved & copied to clipboard`);
    });
  }
  /** Delete the currently selected user preset (with confirmation). */
  async _deleteSelectedPreset() {
    const name = this._presetSelect?.value;
    if (!name) return;
    const userPresets = this._loadUserPresets();
    if (!userPresets[name]) {
      const Cls = this._instrument.constructor;
      if (!canWritePresets() || !Cls.PRESET_DATA) {
        alert(`"${name}" is a built-in preset. Delete it under the dev server, or edit src/web-audio/presets/.`);
        return;
      }
      if (Object.keys(Cls.PRESETS).length <= 1) {
        alert("Can't delete the last preset.");
        return;
      }
      if (!confirm(`Delete built-in preset "${name}" from the repo?`)) return;
      try {
        await deletePresetFromRepo(Cls.PRESET_DATA.instrument, name);
        removePreset(Cls, name);
        this._refreshPresetOptions();
        console.log(`[WAM] Preset "${name}" removed from src/web-audio/presets/${Cls.PRESET_DATA.instrument}.json`);
      } catch (err) {
        console.error(err);
        alert(`Couldn't delete from the repo: ${err.message}`);
      }
      return;
    }
    if (!confirm(`Delete user preset "${name}"?`)) return;
    delete userPresets[name];
    this._saveUserPresets(userPresets);
    this._refreshUserPresetOptions();
    // Select first built-in preset
    if (this._presetSelect.options.length > 0) {
      this._presetSelect.value = this._presetSelect.options[0].value;
    }
  }
  /** Copy all user presets for this instrument to clipboard as a JSON object. */
  _exportAllUserPresets() {
    const userPresets = this._loadUserPresets();
    const names = Object.keys(userPresets);
    if (names.length === 0) {
      alert("No user presets saved for this instrument.");
      return;
    }
    const json = JSON.stringify(userPresets, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      alert(`${names.length} preset(s) copied to clipboard.`);
      console.log(`[WAM] Exported ${names.length} user presets for ${this._instrument?.constructor.name}:\n${json}`);
    });
  }
  /**
   * Build a preset <select> from a PRESETS object and append to container.
   * Stores the element as this._presetSelect.
   * @param {object} PresetsObj  e.g. WebAudioSynthMono.PRESETS
   * @param {HTMLElement} appendTo
   * @deprecated Use _buildPresetSection() instead — kept for backward compat.
   */
  _makePresetDropdown(PresetsObj, appendTo) {
    const wrap = createCtrl("Preset", { tooltip: "Load a sound preset." });
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wam-select";
    for (const name of Object.keys(PresetsObj)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/_/g, " ");
      this._presetSelect.appendChild(opt);
    }
    this._presetSelect.addEventListener("change", () => {
      this.applyPreset(this._presetSelect.value);
      this._emitChange();
    });
    wrap.appendChild(this._presetSelect);
    appendTo.appendChild(wrap);
    return this._presetSelect;
  }
  /**
   * Build an oscillator-type dropdown (SAW/SQR/TRI/SIN etc.) wrapped in createCtrl.
   * Stores references as this._waveSelect and this._waveSelectProp.
   * @param {string[]} types  e.g. ["sawtooth","square","triangle","sine"]
   * @param {HTMLElement} appendTo
   * @param {object} [opts]
   * @param {string} [opts.prop="oscType"]  Property name on instrument
   * @param {string} [opts.label="Shape"]   Control label
   * @param {string} [opts.tooltip]         Tooltip text
   */
  _makeWaveSelect(types, appendTo, { prop = "oscType", label = "Shape", tooltip = null } = {}) {
    this._waveSelectProp = prop;
    const wrap = createCtrl(label, tooltip ? { tooltip } : {});
    this._waveSelect = document.createElement("select");
    this._waveSelect.className = "wam-select";
    for (const type of types) {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type.slice(0, 3).toUpperCase();
      if (this._instrument[prop] === type) opt.selected = true;
      this._waveSelect.appendChild(opt);
    }
    this._registerSelect(prop, this._waveSelect);
    wrap.appendChild(this._waveSelect);
    appendTo.appendChild(wrap);
    return wrap;
  }
  // ---- Preset management ----

  applyPreset(name) {
    if (!this._instrument) return;
    this._instrument.applyPreset(name);
    // Sync all knob-based params through the event path (skip volume — channel strip is independent)
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume") continue;
      const knob = this._sliders[def.param];
      if (knob && this._instrument) {
        const val = this._instrument[def.param];
        knob.value = val;
        knob.dispatchEvent(
          new CustomEvent("knob-input", {
            bubbles: true,
            detail: { param: def.param, value: val },
          }),
        );
      }
    }
    // Sync registered selects
    for (const [param, { el }] of Object.entries(this._selects)) {
      if (this._instrument) el.value = this._instrument[param];
    }
    // Sync registered toggles
    for (const [param, { el, activeClass }] of Object.entries(this._toggles)) {
      if (this._instrument) el.classList.toggle(activeClass, !!this._instrument[param]);
    }
    if (this._presetSelect) this._presetSelect.value = name;
    this._syncExtraControls();
  }
  /** Update all registered sliders from instrument state. */
  _syncSliders() {
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume") continue; // channel strip volume is independent
      const slider = this._sliders[def.param];
      if (slider && this._instrument) slider.value = this._instrument[def.param];
    }
  }
}
