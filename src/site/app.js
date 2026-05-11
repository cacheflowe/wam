import PicoTheme from "./pico-theme.js";

// import apps
import "../app/playground.js";
import "../app/generative-music.js";
import "../app/generative-music-plants.js";
import "../app/generative-ambient.js";
import "../app/vocoder.js";

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
    this.initInstallPrompt();
    this.initHash();
    document.addEventListener("touchstart", function () {}, false); // enable pseudo styles for mobile
  }

  initServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }

  // ---- PWA install prompt ----

  initInstallPrompt() {
    // Skip if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (navigator.standalone) return; // Safari standalone check

    // Chrome/Edge: capture the native install prompt
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this._deferredInstallPrompt = e;
      this._showInstallButton();
    });

    // iOS Safari: no native prompt, show manual instructions
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) this._showInstallButton(true);
  }

  _showInstallButton(isIOS = false) {
    // Avoid duplicate buttons
    if (this.querySelector(".wam-install-btn")) return;

    const btn = document.createElement("button");
    btn.className = "wam-install-btn";
    btn.textContent = "📲 Install App";
    btn.style.cssText = "margin-top: 1rem;";

    btn.addEventListener("click", () => {
      if (isIOS) {
        alert('Tap the Share button in Safari, then choose "Add to Home Screen".');
      } else if (this._deferredInstallPrompt) {
        this._deferredInstallPrompt.prompt();
        this._deferredInstallPrompt.userChoice.then(() => {
          this._deferredInstallPrompt = null;
          btn.remove();
        });
      }
    });

    // Insert after the nav links on the intro page, or at the top
    const section = this.querySelector("section div") || this;
    section.appendChild(btn);

    // Hide if the user installs via browser UI
    window.addEventListener("appinstalled", () => btn.remove());
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
            <a href="#vocoder-app" role="button">Vocoder</a>
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
