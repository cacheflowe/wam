/**
 * Novation Launch Control XL — full MIDI map + LED helpers.
 *
 * Sources:
 * - Novation "Launch Control XL Programmer's Reference" (sysex/LED protocol, indices)
 * - Factory template mapping (knob/fader CCs, button notes) as shipped by Novation
 *
 * Zero dependencies and no Web MIDI calls — every helper returns plain byte
 * arrays you can pass to `MIDIOutput.send()`, so this file is portable to any
 * environment. Binding objects match parseMidiMessage() in
 * ui/midi-input-picker.js: { type: "cc"|"note", channel (1-indexed), controller|note }.
 *
 * Templates: slots 0-7 are user templates, 8-15 are factory templates. Each
 * template transmits on MIDI channel slot+1 (1-indexed). Holding the Factory
 * button and pressing channel button 5 selects factory template 5 (slot 12,
 * channel 13), which is a good standardized default across devices.
 */

export const DEVICE_NAME = "Launch Control XL";

export const USER_TEMPLATE_FIRST = 0;
export const FACTORY_TEMPLATE_FIRST = 8;
export const DEFAULT_TEMPLATE = 12; // factory template 5

/** 1-indexed MIDI channel a template transmits/listens on. */
export function templateChannel(template = DEFAULT_TEMPLATE) {
  return template + 1;
}

/**
 * Inverse of templateChannel: the template slot a control is on, given the
 * MIDI channel of an incoming message (1-indexed). Returns null if out of range.
 *
 * GOTCHA — sysex LED messages are addressed by template byte, not channel, BUT
 * the device only *displays* LEDs for the template it is currently showing.
 * Writing LEDs to a template the device isn't displaying succeeds silently and
 * shows nothing. Since each template transmits on channel = slot + 1, the most
 * reliable approach is to read the incoming channel and target that template's
 * LEDs (templateFromChannel(message.channel)) rather than assuming a fixed slot.
 */
export function templateFromChannel(channel) {
  if (channel < 1 || channel > 16) return null;
  return channel - 1;
}

// ---------------------------------------------------------------------------
// Control map — factory template CC/note assignments (same layout on every
// factory template; only the MIDI channel changes per template slot).
// ---------------------------------------------------------------------------

export const KNOBS_ROW_1 = [13, 14, 15, 16, 17, 18, 19, 20]; // CC, "Send A"
export const KNOBS_ROW_2 = [29, 30, 31, 32, 33, 34, 35, 36]; // CC, "Send B"
export const KNOBS_ROW_3 = [49, 50, 51, 52, 53, 54, 55, 56]; // CC, "Pan/Device"
export const SLIDERS = [77, 78, 79, 80, 81, 82, 83, 84]; // CC
export const BUTTONS_ROW_1 = [41, 42, 43, 44, 57, 58, 59, 60]; // note, "Track Focus"
export const BUTTONS_ROW_2 = [73, 74, 75, 76, 89, 90, 91, 92]; // note, "Track Control"
export const BUTTONS_SIDE = [105, 106, 107, 108]; // note: Device, Mute, Solo, Record Arm
export const BUTTONS_ARROWS = [104, 105, 106, 107]; // CC: Up, Down, Left, Right

const SIDE_NAMES = ["device", "mute", "solo", "recordArm"];
const ARROW_NAMES = ["up", "down", "left", "right"];

function buildControls() {
  const controls = [];
  const row8 = (ids, kind, group, midiType, ccsOrNotes, ledBase) => {
    ccsOrNotes.forEach((num, i) => {
      controls.push({
        id: `${ids}${i + 1}`,
        group,
        kind,
        col: i + 1,
        midiType, // "cc" | "note"
        number: num,
        // Sysex LED index (null = no LED), per programmer's reference
        ledIndex: ledBase == null ? null : ledBase + i,
        // Sysex toggle-state index for buttons set to Toggle mode
        toggleIndex: null,
        ledColors: ledBase == null ? null : "red-green",
      });
    });
  };
  row8("knobA", "knob", "knobsRow1", "cc", KNOBS_ROW_1, 0);
  row8("knobB", "knob", "knobsRow2", "cc", KNOBS_ROW_2, 8);
  row8("knobC", "knob", "knobsRow3", "cc", KNOBS_ROW_3, 16);
  row8("fader", "fader", "sliders", "cc", SLIDERS, null);
  row8("focus", "button", "buttonsRow1", "note", BUTTONS_ROW_1, 24);
  row8("control", "button", "buttonsRow2", "note", BUTTONS_ROW_2, 32);
  controls.forEach((c) => {
    if (c.group === "buttonsRow1") c.toggleIndex = c.col - 1;
    if (c.group === "buttonsRow2") c.toggleIndex = 8 + c.col - 1;
  });
  BUTTONS_SIDE.forEach((note, i) => {
    controls.push({
      id: SIDE_NAMES[i],
      group: "buttonsSide",
      kind: "button",
      col: i + 1,
      midiType: "note",
      number: note,
      ledIndex: 40 + i,
      toggleIndex: 16 + i,
      ledColors: "yellow",
    });
  });
  BUTTONS_ARROWS.forEach((cc, i) => {
    controls.push({
      id: ARROW_NAMES[i],
      group: "buttonsArrows",
      kind: "button",
      col: i + 1,
      midiType: "cc",
      number: cc,
      ledIndex: 44 + i,
      toggleIndex: 20 + i,
      ledColors: "red",
    });
  });
  return controls;
}

/** All 56 physical controls: 24 knobs, 8 faders, 24 buttons. */
export const CONTROLS = buildControls();

const controlsById = new Map(CONTROLS.map((c) => [c.id, c]));

export function getControl(id) {
  return controlsById.get(id) ?? null;
}

/**
 * App-format binding for a control, usable with midiBindingsEqual() and
 * MidiParamLearnMixin bindings: { type, channel, controller|note }.
 */
export function bindingFor(idOrControl, template = DEFAULT_TEMPLATE) {
  const control = typeof idOrControl === "string" ? getControl(idOrControl) : idOrControl;
  if (!control) return null;
  const channel = templateChannel(template);
  return control.midiType === "cc"
    ? { source: "midi", type: "cc", channel, controller: control.number }
    : { source: "midi", type: "note", channel, note: control.number };
}

/**
 * Reverse lookup: which physical control produced this binding/message?
 * Matches by message type + CC/note number (the layout is identical on every
 * template). Pass a template to also require that template's MIDI channel.
 */
export function findControl(binding, { template = null } = {}) {
  if (!binding) return null;
  if (template != null && binding.channel != null && binding.channel !== templateChannel(template)) return null;
  const number = binding.type === "cc" ? binding.controller : binding.note;
  return CONTROLS.find((c) => c.midiType === binding.type && c.number === number) ?? null;
}

/** Full map of every control's binding, keyed by control id. */
export function fullMidiMap(template = DEFAULT_TEMPLATE) {
  const map = {};
  for (const control of CONTROLS) map[control.id] = bindingFor(control, template);
  return map;
}

// ---------------------------------------------------------------------------
// LED colors — velocity byte packs red (bits 0-1) + green (bits 4-5) + flags.
// Knobs and channel buttons mix red+green (amber); side buttons are yellow
// only; arrow buttons are red only.
// ---------------------------------------------------------------------------

/**
 * Build an LED velocity byte. red/green are 0-3 brightness.
 * flash requires flashing mode (see flashMessage / doubleBufferMessage).
 */
export function ledVelocity(red, green, { flash = false, doubleBuffer = false } = {}) {
  const flags = doubleBuffer ? 0 : flash ? 8 : 12;
  return 16 * (green & 3) + (red & 3) + flags;
}

export const LED = {
  OFF: 12,
  RED_LOW: 13,
  RED_FULL: 15,
  AMBER_LOW: 29,
  AMBER_FULL: 63,
  YELLOW_FULL: 62,
  GREEN_LOW: 28,
  GREEN_FULL: 60,
  FLASH_RED: 11,
  FLASH_AMBER: 59,
  FLASH_YELLOW: 58,
  FLASH_GREEN: 56,
};

/** Ordered low→high color ramp, handy for metering (off → red → amber → green). */
export const LED_RAMP = [
  LED.OFF,
  LED.RED_LOW,
  LED.RED_FULL,
  LED.AMBER_LOW,
  LED.AMBER_FULL,
  LED.YELLOW_FULL,
  LED.GREEN_LOW,
  LED.GREEN_FULL,
];

/** Map a 0..1 value onto the LED color ramp. */
export function ledColorByPercent(percent) {
  const norm = Math.max(0, Math.min(1, percent));
  return LED_RAMP[Math.min(LED_RAMP.length - 1, Math.floor(norm * LED_RAMP.length))];
}

// ---------------------------------------------------------------------------
// Outgoing messages — each returns a byte array for MIDIOutput.send().
// ---------------------------------------------------------------------------

const SYSEX_HEADER = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x11];

/**
 * Set one or more LEDs on any template via sysex (works in the background,
 * regardless of the selected template). pairs: [[ledIndex, velocity], ...].
 */
export function setLedsMessage(pairs, template = DEFAULT_TEMPLATE) {
  return [...SYSEX_HEADER, 0x78, template, ...pairs.flat(), 0xf7];
}

/** Set a single control's LED by control id. */
export function setLedMessage(controlId, velocity, template = DEFAULT_TEMPLATE) {
  const control = getControl(controlId);
  if (!control || control.ledIndex == null) return null;
  return setLedsMessage([[control.ledIndex, velocity]], template);
}

/**
 * Set toggle-mode button states via sysex. pairs: [[toggleIndex, 0|127], ...].
 * Ignored by the device for buttons configured as Momentary.
 */
export function setTogglesMessage(pairs, template = DEFAULT_TEMPLATE) {
  return [...SYSEX_HEADER, 0x7b, template, ...pairs.flat(), 0xf7];
}

/** Switch the device to a template slot (0-7 user, 8-15 factory). */
export function selectTemplateMessage(template = DEFAULT_TEMPLATE) {
  return [...SYSEX_HEADER, 0x77, template, 0xf7];
}

/** All LEDs off; buffer settings and duty cycle reset, for one template. */
export function resetMessage(template = DEFAULT_TEMPLATE) {
  return [0xb0 + template, 0x00, 0x00];
}

/** LED test: light every LED at brightness 1-3. Resets all other LED state. */
export function allLedsOnMessage(brightness = 3, template = DEFAULT_TEMPLATE) {
  const clamped = Math.max(1, Math.min(3, Math.round(brightness)));
  return [0xb0 + template, 0x00, 0x7c + clamped];
}

/** Enable automatic flashing (device-timed) for LEDs set with flash velocities. */
export function flashMessage(template = DEFAULT_TEMPLATE) {
  return [0xb0 + template, 0x00, 0x28];
}

/**
 * Double-buffering control. Velocity data byte built per the programmer's
 * reference: 0x20 + display + 4*update (+ 0x10 copy, + 0x08 flash).
 */
export function doubleBufferMessage(
  { display = 0, update = 0, copy = false, flash = false } = {},
  template = DEFAULT_TEMPLATE,
) {
  const data = 0x20 + (display & 1) + 4 * (update & 1) + (copy ? 0x10 : 0) + (flash ? 0x08 : 0);
  return [0xb0 + template, 0x00, data];
}

/**
 * Light a button via the channel-message (Launchpad-style) protocol instead
 * of sysex. Only works when the target template is currently selected.
 */
export function buttonLedChannelMessage(controlId, velocity, template = DEFAULT_TEMPLATE) {
  const control = getControl(controlId);
  if (!control || control.kind !== "button") return null;
  const status = (control.midiType === "note" ? 0x90 : 0xb0) + template;
  return [status, control.number, velocity];
}
