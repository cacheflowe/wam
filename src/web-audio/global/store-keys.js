/**
 * Canonical AppStore keys for cross-component shared state.
 *
 * Centralized for DRYness + fewer typos. Values stored under these keys must be
 * SERIALIZABLE (strings/numbers/booleans/ids) — never live DOM elements — so the
 * same state can later sync over the wire via Oversite's AppStoreDistributed.
 * Store live objects locally (singletons/events); publish their *ids* here.
 */
export const StoreKeys = {
  MIDI_INPUT_ID: "midi.inputId",
  TRANSPORT_BPM: "transport.bpm",
  TRANSPORT_PLAYING: "transport.playing",
  SONG_NAME: "song.name",
  DRAWER_OPEN_ID: "drawer.openId",
  FOCUS_INSTRUMENT_ID: "focus.instrumentId",
};
