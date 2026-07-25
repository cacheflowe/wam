# Event Migration Plan — AppStore as the Sync Layer

Status: Draft
Owner: Justin Gitlin
Last Reviewed: 2026-06-19

## Goal

Let a single wam "session" be observed and controlled by other clients in real
time — a second browser as a **remote control**, another musician **jamming**
on their own UI, or an external system (e.g. TouchDesigner) **observing** the
performance to drive graphics. The transport is the Oversite
[`AppStoreDistributed`](../../.ai/skills/oversite-app-store.md) WebSocket bus.

This doc records the architecture and the incremental migration path. It does
**not** rip out the existing `CustomEvent` system — see [Two systems, one seam](#two-systems-one-seam).

## Core insight: two data flows, opposite requirements

| | **Session state** (the "document") | **Performance stream** (the "pulse") |
|---|---|---|
| Examples | BPM, instrument params, step patterns, FX, root/scale | trigger events, beat/step ticks |
| Frequency | Low — when a human edits | High — ~10–50 msgs/sec while playing |
| Direction | Bidirectional (any client edits) | One-way (host → observers) |
| Persisted to server state JSON? | **Yes** | **No** |
| AppStore call | `set(k, v, true)` — stored + echoed | `set(k, v, true, null, true)` — sendonly, not persisted |

You never resend the whole song JSON, and the high-frequency pulse never touches
the persisted JSON at all. New clients are hydrated by the Oversite server,
which persists per-channel state and replays it on connect — so no custom
snapshot/replay log is needed.

## Two hard architectural lines (non-negotiable)

These two things **cannot** route through AppStore, so "everything through
AppStore" is really "everything except":

1. **Sample-accurate audio scheduling stays local.** The lookahead scheduler
   (`src/web-audio/global/sequencer.js`) schedules steps ~100ms ahead and passes
   a precise Web Audio timestamp to `instrument.trigger(velocity, time)`
   (`src/app/playground.js:758`). AppStore messages are async and carry no
   audio-clock time. Triggers are *scheduled locally*; only a **copy** is
   broadcast for visualization/external consumers.
2. **Events that carry live objects stay as `CustomEvent`s.** Anything whose
   `detail` is a DOM node, `AudioNode`, or `MIDIAccess` can't serialize. See
   bucket C.

## Two systems, one seam

`CustomEvent`s remain the **intra-app** wiring (in-DOM component events, the
`knob-input` → param path documented in
[event-driven-control.md](event-driven-control.md)). AppStore is the
**inter-app** layer. The bridge between them is a single top-level listener
(starting in `src/app/playground.js`, later generalizable to
`src/site/app.js`) that:

- watches the meaningful local events and **publishes the shared subset** as
  AppStore keys, and
- **applies inbound remote updates** by calling existing methods
  (`ctrl.fromJSON()`, transport setters), guarded against re-broadcast.

### Local-first + echo suppression (not bounce-back)

`AppStoreDistributed.set(k, v, true)` does **not** update local state
immediately — it sends to the socket and updates locally on the server echo
(`app-store-distributed.mjs:61`). That's fine because the app performs its own
local action directly (audio, UI) and treats the store key purely as a sync
signal — so the host never waits on a network round trip to hear itself.

To prevent feedback loops, the apply path is **idempotent**: an inbound update
that already matches local state is a no-op. (For play/stop this is a simple
`value === this._playing` guard; for richer state, compare or use a
`_applyingRemote` flag like the existing `_isLoadingState` at
`src/app/playground.js:950`.)

## Event buckets

Verified against the codebase. "Source" is `file:line` of the dispatch.

### Bucket A — Shared session state → AppStore, stored, bidirectional

The bridge publishes the *resulting value*, not the event.

| Event | Source | Becomes |
|---|---|---|
| `controls-change` | `controls-base.js:1015`, `slider.js:805/812`, `time-stretch.js:307` | trigger to publish that instrument's changed state |
| `step-change` | `step-seq.js:506/652` | `inst.<id>.steps` |
| `pattern-change` | `step-seq.js:515` | `inst.<id>.patternParams` |
| `solo-change` | `slider.js:811` | `inst.<id>.solo` |
| `source-change` | `instrument-source-picker.js:43/69` | `inst.<id>.source` |
| `transport-scale-change` | `transport.js:368` | `transport.root` / `transport.scale` |
| `transport-play` / `transport-stop` | `transport.js:403/414` | `transport.playing` |
| `arrangement-load` | `arrangement-library.js:376` | sets the whole document (cascades) |

### Bucket B — Performance stream → AppStore, `store:false`, host→observers

Broadcast a copy; the original stays local and sample-accurate.

| Event | Source | Becomes |
|---|---|---|
| `wam-trigger` | `controls-base.js:410` (routed via `e.target` at `playground.js:642`) | `trigger.<instrument>` = `{velocity, step}` |
| beat tick | `analysisBus.setBeat(...)` caller `playground.js:755` | `transport.beat` = `{step, bar, phase, bpm}` |
| `step-active` | `step-seq.js:614` | covered by `transport.beat` — not sent separately |

### Bucket C — Stays a `CustomEvent` (cannot/should not serialize)

| Event | Source | Why local |
|---|---|---|
| `wam-instrument-focus` | `controls-base.js:196`, `playground.js:407` | live element |
| `wam-instrument-focus-change` | `focus-manager.js:57` | live element |
| `instrument-bus-update` | `playground.js:785` | live `AudioNode`s |
| `midi-access-ready` | `midi-input-picker.js:234` | live `MIDIAccess` |
| `midi-input-change` | `midi-input-picker.js:261` | live device + per-client hardware |
| `knob-input` / `slider-input` | `knob.js`, `slider.js`, `controls-base.js` | intra-component; value surfaces via A |
| `wam-control-input` / `wam-command` / `wam-binding-feedback` | `input-bindings.js:34/42/51` | local input routing; effects surface via A |
| `wam-midi-message` | `midi-input-picker.js:273` | local input |
| `controls-error` | `sample-looper.js:663` | local UI error |
| `drawer-toggle` | `drawer.js:140` | local **unless remote-control** — see D |

### Bucket D — Role-conditional UI state → AppStore, only for a *remote control*

Synced only when the peer's role is `control` (a jamming musician keeps their own
screen). Keys already exist in `src/web-audio/global/store-keys.js`.

| What | Derived from | Key | Shared when |
|---|---|---|---|
| Focused/active instrument | `wam-instrument-focus` | `FOCUS_INSTRUMENT_ID` | role = control |
| Open drawer panel | `drawer-toggle` | `DRAWER_OPEN_ID` | role = control |
| Visualizer / sketch mode | viz selector | `viz.mode` (new) | role = control |
| Selected MIDI device | `midi-input-change` | `MIDI_INPUT_ID` | **never** — per-client hardware |

## Roles

A single `role` switch (URL param `?role=`) gates bucket D:

- **`host`** (default) — owns audio, source of truth on connect, emits B.
- **`jam`** — syncs A + B; runs its own local transport on the shared
  BPM/downbeat/patterns. (Loose musical sync, not sample-locked — see below.)
- **`control`** — syncs A + B + D; mirrors and drives the host's UI.
- **`observer`** — receives B only (e.g. TouchDesigner).

### Remote co-play is loosely synced, by physics

Sample-accurate audio across machines is impossible (network latency ≫ audio
timing). Co-play means each client runs its own transport locked to shared
BPM + downbeat + patterns: tight local audio, identical patterns, started
together. Musically aligned, not sample-locked. Later phase.

## Phasing

- **Phase 0 — Foundation.** Opt into `AppStoreDistributed` behind config
  (`?sync=<ws>&channel=&role=`); local-only `AppStore` remains the default so
  nothing breaks offline. *(done — see First Slice)*
- **Phase 1 — Transport play/stop.** Bidirectional play toggle. *(done — First Slice)*
- **Phase 2 — Session state (A).** Bridge publishes transport scalars +
  per-instrument sub-blobs (`params` / `steps` / `patternParams` / `fx`);
  echo-suppressed apply; add/remove/reorder via `instruments.list`.
- **Phase 3 — Roles + control surface (D).** Role gating, lightweight control UI.
- **Phase 4 — Performance stream (B).** Broadcast `trigger.*` / `transport.beat`
  for external consumers; document the wire contract.
- **Phase 5 (stretch) — Remote co-play.** Shared BPM/downbeat loose sync.

## First Slice (Phase 0 + 1) — transport play toggle

Smallest end-to-end proof: two clients on the same channel, play in one toggles
the other.

1. **`src/site/app.js`** — pick the store by URL param. Local `AppStore` unless
   `?sync=<ws-url>` is present; then `AppStoreDistributed(url, senderId, channel)`.
   `?role=` is stashed on `window._syncRole` for later role-aware bridging.
2. **`src/web-audio/ui/transport.js`**
   - `_play()` / `_stop()` broadcast: `set(TRANSPORT_PLAYING, bool, true)`.
     (In local-only mode the extra arg is ignored — same behavior as before.)
   - `init()` registers the transport as a store listener once.
   - `storeUpdated(key, value)` applies remote toggles with the equality guard:
     `if (key === TRANSPORT_PLAYING && value !== this._playing) value ? play() : stop()`.

### Try it

Run the Oversite server (`:3003`), then open two tabs:

```
http://localhost:8005/#playground-app?sync=ws://localhost:3003/ws&channel=wam&role=host
http://localhost:8005/#playground-app?sync=ws://localhost:3003/ws&channel=wam&role=control
```

Click Play in one — the other follows. (Each tab needs a user gesture before its
own AudioContext will produce sound; a pure control surface may stay silent.)

## Open decisions

- **solo / source** — confirmed shared (already in `toJSON()`); revisit if a
  jammer wants independent solos.
- **`transport.playing`** — currently always shared (A). Decide later whether a
  *jammer* follows host stop or only a *control* does.
- **trigger key shape** — `trigger.<instrument>` (per-instrument subscription)
  vs. a single `trigger` key with instrument in payload. Leaning per-instrument.
- **bridge location** — `playground.js` first; generalize to `app.js` once proven.

## Related

- [event-driven-control.md](event-driven-control.md) — the intra-app event path that stays
- [.ai/skills/oversite-app-store.md](../../.ai/skills/oversite-app-store.md) — AppStore / AppStoreDistributed API
- [bpm-synced-timing.md](bpm-synced-timing.md) — why audio timing is local and clock-precise
