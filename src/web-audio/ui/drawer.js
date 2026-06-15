/**
 * <wam-drawer> — a single shared slide-out panel for app tools.
 *
 * One drawer hosts many tool panels; only one is open at a time. Every tool
 * launches, appears, and hides the same way: slide-in from the right, dim
 * backdrop, and dismiss via the close button, the backdrop, or Escape.
 *
 * Panels are registered once and kept mounted (toggled with `hidden`), so a
 * tool's state survives open/close without re-running connect/disconnect.
 *
 * Usage:
 *   const drawer = document.createElement("wam-drawer");
 *   document.body.appendChild(drawer);
 *   drawer.addPanel("songs", libraryEl, "Songs");
 *   drawer.toggle("songs");          // open (or close if already showing songs)
 *
 * Events (bubbling): `drawer-toggle` { id, open } whenever the open panel changes
 * — launcher buttons listen to reflect active state.
 */
let _cssInjected = false;

function injectDrawerCSS() {
  if (_cssInjected || typeof document === "undefined") return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = /*css*/ `
    wam-drawer {
      position: fixed; inset: 0; z-index: 1000;
      pointer-events: none;
    }
    wam-drawer .wam-drawer-backdrop {
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.5);
      opacity: 0; transition: opacity 0.2s ease;
      pointer-events: none;
    }
    wam-drawer[data-open] { pointer-events: auto; }
    wam-drawer[data-open] .wam-drawer-backdrop { opacity: 1; pointer-events: auto; }
    wam-drawer .wam-drawer-panel {
      position: absolute; top: 0; right: 0; height: 100%;
      width: min(460px, 92vw);
      background: #12121c; border-left: 1px solid #2a2a3a;
      transform: translateX(100%); transition: transform 0.22s ease;
      display: flex; flex-direction: column;
    }
    wam-drawer[data-open] .wam-drawer-panel { transform: translateX(0); }
    wam-drawer .wam-drawer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; border-bottom: 1px solid #2a2a3a; flex: 0 0 auto;
    }
    wam-drawer .wam-drawer-title {
      font: 600 0.95rem/1 system-ui, sans-serif; color: #cfcff0; margin: 0;
    }
    wam-drawer .wam-drawer-close {
      background: none; border: none; color: #9a9ac0; cursor: pointer;
      font-size: 1.3rem; line-height: 1; padding: 0 0.3rem;
    }
    wam-drawer .wam-drawer-close:hover { color: #fff; }
    wam-drawer .wam-drawer-body {
      flex: 1 1 auto; overflow: auto; padding: 1rem;
    }
    @media (prefers-reduced-motion: reduce) {
      wam-drawer .wam-drawer-panel, wam-drawer .wam-drawer-backdrop { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

export default class WamDrawer extends HTMLElement {
  connectedCallback() {
    injectDrawerCSS();
    this._openId = null;
    this._titles = new Map();
    if (this._built) return;
    this._built = true;

    this.innerHTML = `
      <div class="wam-drawer-backdrop"></div>
      <aside class="wam-drawer-panel" role="dialog" aria-modal="true">
        <div class="wam-drawer-header">
          <h2 class="wam-drawer-title"></h2>
          <button class="wam-drawer-close" aria-label="Close">×</button>
        </div>
        <div class="wam-drawer-body"></div>
      </aside>
    `;
    this._titleEl = this.querySelector(".wam-drawer-title");
    this._body = this.querySelector(".wam-drawer-body");
    this.querySelector(".wam-drawer-backdrop").addEventListener("click", () => this.close());
    this.querySelector(".wam-drawer-close").addEventListener("click", () => this.close());
    this._onKey = (e) => {
      if (e.key === "Escape" && this.hasAttribute("data-open")) this.close();
    };
    document.addEventListener("keydown", this._onKey);
  }

  disconnectedCallback() {
    if (this._onKey) document.removeEventListener("keydown", this._onKey);
  }

  /** Register a tool panel. Kept mounted; shown/hidden on open/close. */
  addPanel(id, element, title) {
    this._titles.set(id, title ?? id);
    element.dataset.drawerPanel = id;
    element.hidden = true;
    this._body.appendChild(element);
    return this;
  }

  get openId() {
    return this.hasAttribute("data-open") ? this._openId : null;
  }

  open(id) {
    if (!this._titles.has(id)) return;
    this._openId = id;
    for (const panel of this._body.children) {
      panel.hidden = panel.dataset.drawerPanel !== id;
    }
    this._titleEl.textContent = this._titles.get(id);
    this.setAttribute("data-open", "");
    this._emit(id, true);
  }

  close() {
    if (!this.hasAttribute("data-open")) return;
    const wasOpen = this._openId;
    this.removeAttribute("data-open");
    this._openId = null;
    this._emit(wasOpen, false);
  }

  /** Open `id`, or close if it's already the open panel. */
  toggle(id) {
    if (this.openId === id) this.close();
    else this.open(id);
  }

  _emit(id, open) {
    this.dispatchEvent(new CustomEvent("drawer-toggle", { bubbles: true, detail: { id, open } }));
  }
}

customElements.define("wam-drawer", WamDrawer);
