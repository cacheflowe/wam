import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { presetMap, presetTags, upsertPreset, removePreset, presetParamDefs, isPartParam } from "../src/web-audio/global/presets.js";
import wamPresetStore from "../vite-plugins/wam-preset-store.js";

const PRESET_DIR = path.resolve(__dirname, "../src/web-audio/presets");
const modules = import.meta.glob("../src/web-audio/instruments/*.js", { eager: true });
const INSTRUMENTS = Object.entries(modules)
  .map(([file, mod]) => [path.basename(file, ".js"), mod.default])
  .filter(([, Cls]) => Cls?.PRESET_DATA);

describe("preset data files", () => {
  it("every preset file is wired to its instrument module", () => {
    const files = fs.readdirSync(PRESET_DIR).filter((f) => f.endsWith(".json")).map((f) => path.basename(f, ".json"));
    expect(INSTRUMENTS.map(([id]) => id).sort()).toEqual(files.sort());
  });

  describe.each(INSTRUMENTS)("%s", (id, Cls) => {
    const data = Cls.PRESET_DATA;

    it("has a well-formed file", () => {
      expect(data.instrument).toBe(id);
      const names = data.presets.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      for (const p of data.presets) {
        expect(typeof p.name).toBe("string");
        expect(Array.isArray(p.tags)).toBe(true);
        expect(typeof p.params).toBe("object");
        expect(p.params.volume, `${p.name}.volume`).toBeTypeOf("number");
      }
      expect(Object.keys(Cls.PRESETS)).toEqual(names);
    });

    it.runIf(!!Cls.PARAMS)("every preset defines every sound param (no leakage between presets)", () => {
      const required = presetParamDefs(Cls.PARAMS).map((d) => d.param);
      for (const p of data.presets) {
        const missing = required.filter((k) => !(k in p.params));
        expect(missing, `${p.name} missing`).toEqual([]);
      }
    });
  });
});

describe("preset helpers", () => {
  const makeCls = () => {
    const data = { instrument: "x", presets: [{ name: "A", tags: ["bass"], params: { volume: 1 } }] };
    return { PRESET_DATA: data, PRESETS: presetMap(data) };
  };

  it("presetMap / presetTags", () => {
    const Cls = makeCls();
    expect(Cls.PRESETS).toEqual({ A: { volume: 1 } });
    expect(presetTags(Cls.PRESET_DATA, "A")).toEqual(["bass"]);
    expect(presetTags(Cls.PRESET_DATA, "nope")).toEqual([]);
  });

  it("upsert adds or replaces; remove deletes — both keep PRESETS in sync", () => {
    const Cls = makeCls();
    upsertPreset(Cls, { name: "B", params: { volume: 0.5 } });
    upsertPreset(Cls, { name: "A", tags: ["lead"], params: { volume: 0.7 } });
    expect(Cls.PRESET_DATA.presets.map((p) => p.name)).toEqual(["A", "B"]);
    expect(Cls.PRESETS.A).toEqual({ volume: 0.7 });
    removePreset(Cls, "A");
    expect(Object.keys(Cls.PRESETS)).toEqual(["B"]);
    expect(Cls.PRESET_DATA.presets.map((p) => p.name)).toEqual(["B"]);
  });

  it("part-level params are excluded from complete presets", () => {
    expect(isPartParam({ param: "octaveOffset", group: "pitch", role: "octave" })).toBe(true);
    expect(isPartParam({ param: "gate", group: "amp-env", role: "gate" })).toBe(true);
    expect(isPartParam({ param: "x", group: "seq" })).toBe(true);
    expect(isPartParam({ param: "cutoff", group: "filter", role: "cutoff" })).toBe(false);
  });
});

describe("wam-preset-store dev plugin", () => {
  let root;
  let handler;
  let plugin;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wam-presets-"));
    fs.mkdirSync(path.join(root, "presets"));
    fs.writeFileSync(
      path.join(root, "presets", "synth-x.json"),
      JSON.stringify({ instrument: "synth-x", presets: [{ name: "Keep", tags: [], params: { volume: 1 } }] }),
    );
    plugin = wamPresetStore({ dir: "presets" });
    plugin.configResolved({ root });
    plugin.configureServer({ middlewares: { use: (fn) => (handler = fn) } });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** Drive the middleware with a fake request; resolves to { status, body }. */
  function call(method, url, body) {
    return new Promise((resolve) => {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
      req.method = method;
      req.url = url;
      const res = {
        statusCode: 200,
        setHeader() {},
        end(text) {
          resolve({ status: this.statusCode, body: JSON.parse(text) });
        },
      };
      handler(req, res, () => resolve({ status: "next" }));
    });
  }

  const read = () => JSON.parse(fs.readFileSync(path.join(root, "presets", "synth-x.json"), "utf8"));

  it("ignores other routes", async () => {
    expect((await call("GET", "/src/main.js")).status).toBe("next");
  });

  it("POST adds a preset, then replaces it by name", async () => {
    let r = await call("POST", "/__wam/presets/synth-x", { name: "New", tags: ["bass", " ", 3], params: { volume: 0.5 } });
    expect(r).toEqual({ status: 200, body: { ok: true, replaced: false } });
    r = await call("POST", "/__wam/presets/synth-x", { name: "New", params: { volume: 0.9 } });
    expect(r.body.replaced).toBe(true);
    const data = read();
    expect(data.presets.map((p) => p.name)).toEqual(["Keep", "New"]);
    expect(data.presets[1]).toEqual({ name: "New", tags: [], params: { volume: 0.9 } });
  });

  it("first POST keeps the cleaned tags", async () => {
    await call("POST", "/__wam/presets/synth-x", { name: "T", tags: ["bass", " ", 3, " lead "], params: { volume: 1 } });
    expect(read().presets[1].tags).toEqual(["bass", "lead"]);
  });

  it("DELETE removes a preset; 404 when missing", async () => {
    expect((await call("DELETE", "/__wam/presets/synth-x/Keep")).status).toBe(200);
    expect(read().presets).toEqual([]);
    expect((await call("DELETE", "/__wam/presets/synth-x/Keep")).status).toBe(404);
  });

  it("rejects bad ids, unknown instruments, bad bodies", async () => {
    expect((await call("POST", "/__wam/presets/..%2F..%2Fetc", { name: "x", params: {} })).status).toBe(400);
    expect((await call("POST", "/__wam/presets/synth-nope", { name: "x", params: {} })).status).toBe(404);
    expect((await call("POST", "/__wam/presets/synth-x", { name: "", params: {} })).status).toBe(400);
    expect((await call("POST", "/__wam/presets/synth-x", { name: "x", params: [] })).status).toBe(400);
    expect((await call("PUT", "/__wam/presets/synth-x", { name: "x", params: {} })).status).toBe(405);
  });

  it("its own writes skip HMR; other edits don't", async () => {
    await call("POST", "/__wam/presets/synth-x", { name: "N", params: { volume: 1 } });
    const file = path.join(root, "presets", "synth-x.json");
    expect(plugin.handleHotUpdate({ file })).toEqual([]);
    expect(plugin.handleHotUpdate({ file })).toBeUndefined(); // a later hand edit reloads normally
  });
});
