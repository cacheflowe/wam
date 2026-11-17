/**
 * Playground share links + the "tap to play" experience for people opening one.
 *
 * Link formats (all on the playground route):
 *   #playground-app&song=<id>   a bundled song, unchanged   (short)
 *   #playground-app&z=<b64>     any session, deflate-compressed JSON
 *   #playground-app&s=<b64>     any session, plain JSON (legacy links + browsers without CompressionStream)
 *
 * Opening a link shows a full-screen ▶ overlay (the browser needs a tap before
 * audio can play anyway). On small screens a floating play/stop button stays
 * available, since the transport's button is easy to miss on a phone.
 */

/** URL-safe id for a song name: "Electro Break" → "electro-break". */
export function songId(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- base64url over UTF-8 bytes ----

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Response(bytes).body.pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const canCompress = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

/** Encode a session state as a hash param: "z=…" (compressed) or "s=…". */
export async function encodeState(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  if (canCompress()) return `z=${bytesToB64url(await pipe(bytes, new CompressionStream("deflate-raw")))}`;
  return `s=${bytesToB64url(bytes)}`;
}

/**
 * Read a share link from a location hash.
 * @returns {Promise<{ songId: string } | { state: object } | null>}
 */
export async function parseShareHash(hash) {
  const parts = String(hash ?? "").replace(/^#/, "").replace("%26", "&").split("&");
  const get = (k) => parts.find((p) => p.startsWith(`${k}=`))?.slice(k.length + 1);
  const id = get("song");
  if (id) return { songId: decodeURIComponent(id) };
  const z = get("z");
  if (z) {
    const bytes = await pipe(b64urlToBytes(z), new DecompressionStream("deflate-raw"));
    return { state: JSON.parse(new TextDecoder().decode(bytes)) };
  }
  const s = get("s");
  if (s) {
    const bytes = b64urlToBytes(s);
    let json;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      json = String.fromCharCode(...bytes); // very old links: Latin-1 btoa
    }
    return { state: JSON.parse(json) };
  }
  return null;
}

/** Hash params that belong to a share link (stripped from the URL after loading). */
export const SHARE_KEYS = ["song", "z", "s"];

/**
 * Hand a link to the platform: native share sheet where there is one (phones),
 * otherwise the clipboard. Resolves to "shared" | "copied" | "cancelled" | "manual".
 */
export async function shareLink({ url, title }) {
  if (navigator.share && matchMedia?.("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title, text: title, url });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    prompt("Copy this link:", url);
    return "manual";
  }
}

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = /* css */ `
    .wam-play-overlay {
      position: fixed; inset: 0; z-index: 2000; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 1.2rem; padding: 2rem;
      background: radial-gradient(circle at 50% 40%, #1b1840 0%, #0d0d14 70%); color: #e8e8ff; text-align: center;
    }
    .wam-play-overlay h1 { margin: 0; font-size: clamp(1.4rem, 6vw, 2.4rem); color: #fff; letter-spacing: .02em; }
    .wam-play-overlay p { margin: 0; opacity: .7; font-size: .9rem; }
    .wam-play-overlay .wam-big-play {
      all: unset; cursor: pointer; width: min(46vw, 180px); aspect-ratio: 1; border-radius: 50%;
      display: grid; place-items: center; font-size: min(18vw, 72px); color: #fff;
      background: #6366f1; box-shadow: 0 0 0 10px rgba(99,102,241,.25), 0 10px 40px rgba(0,0,0,.5);
      transition: transform .1s;
    }
    .wam-play-overlay .wam-big-play:active { transform: scale(.95); }
    .wam-play-overlay .wam-big-play[disabled] { opacity: .4; cursor: progress; }
    .wam-play-overlay .wam-overlay-skip { all: unset; cursor: pointer; opacity: .55; font-size: .8rem; text-decoration: underline; }
    .wam-play-fab {
      all: unset; position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 60;
      width: 64px; height: 64px; border-radius: 50%; display: none; place-items: center;
      background: #6366f1; color: #fff; font-size: 26px; box-shadow: 0 6px 24px rgba(0,0,0,.5); cursor: pointer;
    }
    .wam-play-fab[data-playing] { background: #e0435a; }
    @media (max-width: 760px) { .wam-play-fab { display: grid; } }
    .wam-toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2100;
      background: #222238; color: #fff; border: 1px solid #4a4a7a; border-radius: 8px;
      padding: .5rem .9rem; font-size: .85rem; box-shadow: 0 6px 24px rgba(0,0,0,.4);
    }
  `;
  document.head.appendChild(style);
}

/** Small confirmation message at the bottom of the screen. */
export function toast(text, ms = 2200) {
  injectCSS();
  const el = document.createElement("div");
  el.className = "wam-toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * Full-screen "▶ Play <title>" overlay. The button stays disabled until
 * `ready()`; tapping it calls `onPlay` (inside the gesture, so audio can start).
 * @returns {{ ready(): void, remove(): void, el: HTMLElement }}
 */
export function showPlayOverlay({ title, onPlay }) {
  injectCSS();
  const el = document.createElement("div");
  el.className = "wam-play-overlay";
  el.innerHTML = `<p>Someone shared a song with you</p><h1></h1>
    <button class="wam-big-play" disabled aria-label="Play">▶</button>
    <p class="wam-overlay-status">Loading…</p>
    <button class="wam-overlay-skip">Just look around</button>`;
  el.querySelector("h1").textContent = title || "Shared song";
  const play = el.querySelector(".wam-big-play");
  const status = el.querySelector(".wam-overlay-status");
  const remove = () => el.remove();
  play.addEventListener("click", () => {
    onPlay?.();
    remove();
  });
  el.querySelector(".wam-overlay-skip").addEventListener("click", remove);
  document.body.appendChild(el);
  return {
    el,
    remove,
    ready() {
      play.disabled = false;
      status.textContent = "Tap to play";
      play.focus?.();
    },
  };
}

/**
 * Floating play/stop button for small screens (hidden on wide screens by CSS).
 * @param {{ playing: boolean, play(): void, stop(): void } & EventTarget} transport
 * @param {() => void} [beforePlay]  e.g. resume the AudioContext (must run in the tap)
 */
export function mountPlayFab(transport, beforePlay) {
  injectCSS();
  const fab = document.createElement("button");
  fab.className = "wam-play-fab";
  const sync = () => {
    fab.textContent = transport.playing ? "■" : "▶";
    fab.toggleAttribute("data-playing", !!transport.playing);
    fab.setAttribute("aria-label", transport.playing ? "Stop" : "Play");
  };
  fab.addEventListener("click", () => {
    if (transport.playing) transport.stop();
    else {
      beforePlay?.();
      transport.play();
    }
  });
  transport.addEventListener("transport-play", sync);
  transport.addEventListener("transport-stop", sync);
  sync();
  document.body.appendChild(fab);
  return () => {
    transport.removeEventListener("transport-play", sync);
    transport.removeEventListener("transport-stop", sync);
    fab.remove();
  };
}
