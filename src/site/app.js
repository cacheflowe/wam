import PicoTheme from "./pico-theme.js";
import AppStore from "oversite/src/app-store/app-store-.mjs";
import AppStoreDistributed from "oversite/src/app-store/app-store-distributed.mjs";

// Global shared-state store. Both classes set window._store and fire an
// "appstore-ready" event; created before any app/component mounts so every
// component can read/write window._store.
//
// Default: local-only AppStore. Opt into multi-client sync by adding a ?sync=
// WebSocket URL, e.g.
//   #playground-app?sync=ws://localhost:3003/ws&channel=wam&role=control
// In sync mode, broadcast set()s go through the Oversite server and echo to all
// clients. See docs/design-docs/event-migration-plan.md.
(function initStore() {
  const params = new URLSearchParams(location.search);
  const syncUrl = params.get("sync");
  if (syncUrl) {
    const channel = params.get("channel") || "wam";
    const role = params.get("role") || "host";
    const senderId = `wam_${role}_${Math.random().toString(36).slice(2, 8)}`;
    window._syncRole = role; // read later for role-aware bridging (bucket D)
    new AppStoreDistributed(syncUrl, senderId, channel);
  } else {
    new AppStore();
  }
})();

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
