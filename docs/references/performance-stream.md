# Performance Stream — Wire Contract for Visualizers

The Instrument Playground broadcasts **what the music is doing** — every note, every 16th-note tick, and which instrument is in which slot — over [Oversite AppStore](../../.ai/skills/oversite-app-store.md). Any AppStore client can draw from it: TouchDesigner, p5.js, a second browser, a Node script.

Source: [src/web-audio/global/performance-stream.js](../../src/web-audio/global/performance-stream.js) (publisher), bridge in [src/app/playground.js](../../src/app/playground.js) (`_streamNote`, beat tick in the sequencer callback, `_publishInstrumentList`). Design background: [event-migration-plan.md](../design-docs/event-migration-plan.md) (Bucket B).

## Connecting

1. Run an Oversite server (default `ws://localhost:3003/ws`). The channel you use must be allowed by that server's config — a stock server only allows `default` and `dashboard`.
2. Open the playground with sync enabled:

   ```
   https://localhost:8005/?sync=ws://localhost:3003/ws&channel=wam#playground-app
   ```

   (`role` defaults to `host`. Only the host publishes the stream; `control` / `jam` / `observer` clients don't, so notes are never duplicated.)
3. Connect your visualizer to the same server + channel. It just listens.

Without `?sync=`, the playground uses a local AppStore and the same keys are delivered to in-page listeners (`window._store`) — handy for a p5 sketch running inside the page.

## Keys

| Key | Rate | Persisted on server | Value |
|---|---|---|---|
| `trigger` | one per played note (~10–80/s) | last value only | note object ↓ |
| `transport.beat` | one per 16th note while playing (~8–10/s) | last value only | beat object ↓ |
| `instruments.list` | when instruments are added/removed | yes | array of slots ↓ |

`trigger` and `transport.beat` are sent `sendonly` (the server relays them to everyone except the host). The server keeps the last value of every key, so a client that joins mid-set receives the last note/beat once on connect — ignore it if it matters (check `transport.playing`, or the server-added `time`).

### `trigger`

```json
{
  "key": "trigger",
  "type": "object",
  "store": true,
  "sendonly": true,
  "sender": "wam_host_tdaz57",
  "value": {
    "id": 1,
    "slot": 2,
    "instrument": "acid",
    "name": "Acid",
    "color": "#8f0",
    "notes": [36],
    "note": 36,
    "velocity": 1,
    "accent": true,
    "duration": 0.117,
    "step": 4,
    "bar": 12
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Stable id of this instrument instance for the session. |
| `slot` | 1-based row in the playground = the Launch Control XL fader number. |
| `instrument` | Instrument type: `kick`, `snare`, `hihat`, `acid`, `bass808`, `fm`, `mono`, `pad`, `poly`, `blipfx`, `sampler-kicks`, `sampler-snares`, `sampler-hits`. |
| `name`, `color` | Display name and the instrument's UI color (CSS color) — use it to keep visuals on-palette. |
| `notes` | MIDI note numbers. Chords have several; drums have `[]`. |
| `note` | First of `notes`, or `null` for drums. |
| `velocity` | 0–1. Instruments without a velocity argument report 0.8, or 1.0 when accented. |
| `accent` | Acid accent (others `false`). |
| `duration` | Note length in seconds (synths); `null` for one-shot drums. |
| `step`, `bar` | Sequencer position (0–15, bar count since play) when it fired. |
| `open` | Hi-hat only: open vs. closed. |

### `transport.beat`

```json
{ "step": 0, "bar": 12, "beat": 0, "downbeat": true, "bpm": 128 }
```

`step` 0–15 (16ths), `beat` 0–3 (quarters), `downbeat` true on step 0.

### `instruments.list`

```json
[
  { "slot": 1, "id": 0, "instrument": "kick", "name": "Kick", "color": "#f44" },
  { "slot": 2, "id": 1, "instrument": "acid", "name": "Acid", "color": "#8f0" }
]
```

Build your layout from this (e.g. one visual lane per slot), then animate from `trigger`.

Related session keys you may want: `transport.playing` (bool), `transport.bpm` (number), `song.name` (string) — see [store-keys.js](../../src/web-audio/global/store-keys.js).

## Timing

The playground schedules audio ~100 ms ahead. Each `trigger` / `transport.beat` is **held until the moment it's heard** — its AudioContext time plus the output device latency — then sent. Measured in-browser: delivery lands a median ~46 ms after the scheduled time with ~40 ms output latency, i.e. with the sound. Network hop to a local TouchDesigner/p5 client adds ~1 ms.

Fine-tune by hand if visuals feel early/late on a given setup: `performanceStream.offsetMs = 20` (positive = later). Chrome doesn't throttle timers in a tab that's playing audio, so this holds while the playground tab is in the background.

## Consumers

### p5.js (JS AppStore)

```js
import AppStoreDistributed from "oversite/src/app-store/app-store-distributed.mjs";

const store = new AppStoreDistributed("ws://localhost:3003/ws", "p5_viz", "wam");
const hits = [];
let slots = [];

store.addListener({ trigger: (n) => hits.push({ ...n, born: millis() }) }, "trigger");
store.addListener({ "instruments.list": (list) => (slots = list) }, "instruments.list");

function draw() {
  background(0, 40);
  for (const h of hits) {
    const age = (millis() - h.born) / 400; // fade over 400 ms
    if (age > 1) continue;
    fill(color(h.color));
    const x = map(h.slot, 0, slots.length + 1, 0, width);
    circle(x, height / 2, 200 * h.velocity * (1 - age));
  }
}
```

Inside the playground page itself, skip the connection and use `window._store.addListener(...)` the same way.

### TouchDesigner

Messages are plain JSON text frames, so any WebSocket client works; your TouchDesigner AppStore component should receive `trigger` like any other key. Untested starting point with a raw **WebSocket DAT** (`ws://localhost:3003/ws?sender=td_viz&channel=wam`) callbacks:

```python
import json

def onReceiveText(dat, rowIndex, message):
    msg = json.loads(message)
    if msg.get('key') == 'trigger':
        n = msg['value']
        # e.g. pulse a per-slot CHOP channel, or append to a Table DAT
        op('hits').appendRow([n['slot'], n['instrument'], n['note'], n['velocity'], n['color']])
    elif msg.get('key') == 'transport.beat':
        op('beat')['step'] = msg['value']['step']
    return
```

## Known limits

- The stock `AppStoreDistributed.set()` in oversite 1.0.9 labels object/array values as `"type": "number"`. The playground works around this by sending these keys itself with the correct type (`object` / `array`). Worth fixing upstream so other senders get it right too.
- Loop players (sample-looper) don't publish notes — their trigger runs every step to stay in sync, which isn't a musical event. Muted instruments don't publish.
- A server that persists every `store: true` message keeps the last `trigger` / `transport.beat` in its state file. It writes at most once per second and only the latest value per key, so this is cheap.
