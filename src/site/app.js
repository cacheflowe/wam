import PicoTheme from "./pico-theme.js";
import { syncManager } from "./sync-manager.js";

// Global shared-state store (window._store), created before any app/component
// mounts. Local-only AppStore by default; the playground's Sync drawer (or
// ?sync=<ws-url>&channel=&role= URL params) connects it to an Oversite server.
// See src/site/sync-manager.js and docs/references/performance-stream.md.
syncManager.init();
window._syncManager = syncManager; // console access: _syncManager.settings, .status, .update({...})

// import apps
import "../app/playground.js";
import "../app/generative-music.js";
import "../app/generative-music-plants.js";
import "../app/generative-ambient.js";
import "../app/vocoder.js";
import "../app/launch-control-xl.js";

class CustomApp extends HTMLElement {
  connectedCallback() {
    this.init();
    // _store.addListener(this);
  }

  storeUpdated(key, value) {
    // console.log(key, value);
  }

  init() {
    this.initServiceWorker();
    this.initHash();
    document.addEventListener("touchstart", function () {}, false); // enable pseudo styles for mobile
  }

  initServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }

  initHash() {
    const hash = document.location.hash.replace("%26", "&");
    const parts = hash.substring(1).split("&");
    const demoId = parts[0];
    const isBare = parts.includes("bare");
    if (demoId) {
      document.body.appendChild(document.createElement(demoId));
    } else {
      this.loadIntroMarkup();
      this.applyTheme();
    }

    window.addEventListener("hashchange", () => location.reload());
  }

  applyTheme() {
    // Apply custom Pico theme with extra named color groups
    PicoTheme.apply(
      {
        primary: "#6366f1", // indigo
        secondary: "#475569", // slate
        contrast: "#0f172a", // near-black
        extras: {
          warm: "#f59e0b", // amber — for special buttons
          cool: "#06b6d4", // cyan — for input fields
          earth: "#65a30d", // lime — for compound/monitoring
        },
      },
      this,
    );
  }

  loadIntroMarkup() {
    let markup = /* html */ `
      <main class="container">
        <section>
          <header><h1>wam</h1></header>
          <div>
            <a href="#playground-app" role="button">Instrument Playground</a><br /><br />
            <a href="#generative-music" role="button">Generative Music</a><br /><br />
            <a href="#generative-music-plants" role="button">Plantasia</a><br /><br />
            <a href="#generative-ambient" role="button">Generative Ambient</a><br /><br />
            <a href="#vocoder-app" role="button">Vocoder</a><br /><br />
            <a href="#launch-control-xl-app" role="button">Launch Control XL Tester</a>
          </div>
        </section>
      </main>
      <footer class="container">
        <small>Built by Cacheflowe 🤗</small>
      </footer>
    `;
    this.innerHTML = markup;
  }
}

customElements.define("custom-app", CustomApp);
