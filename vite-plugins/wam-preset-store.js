/**
 * Dev-only Vite plugin: lets the playground write presets back into the repo.
 *
 *   POST   /__wam/presets/<instrument-id>          body: { name, tags?, params }
 *   DELETE /__wam/presets/<instrument-id>/<name>
 *
 * Writes src/web-audio/presets/<instrument-id>.json (the file must already
 * exist — this never creates new instruments). Only active under
 * `vite dev` (configureServer); production builds have no endpoint and the UI
 * falls back to localStorage user presets.
 *
 * Writes made by this plugin skip HMR so saving a preset mid-jam doesn't
 * reload the page and stop the music. Hand edits to the files still reload.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROUTE = "/__wam/presets/";
const ID_RE = /^[a-z0-9-]+$/;
const MAX_BODY = 256 * 1024;

export default function wamPresetStore({ dir = "src/web-audio/presets" } = {}) {
  let presetDir;
  const selfWritten = new Set();

  const fileFor = (id) => path.join(presetDir, `${id}.json`);

  async function readData(id) {
    return JSON.parse(await fs.readFile(fileFor(id), "utf8"));
  }

  async function writeData(id, data) {
    const file = fileFor(id);
    selfWritten.add(path.normalize(file));
    await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) reject(new Error("body too large"));
        else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  return {
    name: "wam-preset-store",
    apply: "serve",

    configResolved(config) {
      presetDir = path.resolve(config.root, dir);
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(ROUTE)) return next();
        try {
          const [rawId, rawName] = req.url.slice(ROUTE.length).split("?")[0].split("/");
          const id = decodeURIComponent(rawId ?? "");
          if (!ID_RE.test(id)) return send(res, 400, { error: "bad instrument id" });
          try {
            await fs.access(fileFor(id));
          } catch {
            return send(res, 404, { error: `no preset file for "${id}"` });
          }

          if (req.method === "POST") {
            const entry = JSON.parse(await readBody(req));
            const name = typeof entry?.name === "string" ? entry.name.trim() : "";
            if (!name || name.length > 80) return send(res, 400, { error: "bad preset name" });
            if (!entry.params || typeof entry.params !== "object" || Array.isArray(entry.params)) {
              return send(res, 400, { error: "params must be an object" });
            }
            const tags = Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
            const data = await readData(id);
            const stored = { name, tags, params: entry.params };
            const i = data.presets.findIndex((p) => p.name === name);
            if (i >= 0) data.presets[i] = stored;
            else data.presets.push(stored);
            await writeData(id, data);
            return send(res, 200, { ok: true, replaced: i >= 0 });
          }

          if (req.method === "DELETE") {
            const name = decodeURIComponent(rawName ?? "");
            if (!name) return send(res, 400, { error: "missing preset name" });
            const data = await readData(id);
            const before = data.presets.length;
            data.presets = data.presets.filter((p) => p.name !== name);
            if (data.presets.length === before) return send(res, 404, { error: `no preset "${name}"` });
            await writeData(id, data);
            return send(res, 200, { ok: true });
          }

          return send(res, 405, { error: "method not allowed" });
        } catch (err) {
          return send(res, 500, { error: String(err?.message ?? err) });
        }
      });
    },

    // Skip HMR for files this plugin just wrote (the UI already updated itself).
    handleHotUpdate(ctx) {
      const file = path.normalize(ctx.file);
      if (selfWritten.has(file)) {
        selfWritten.delete(file);
        return [];
      }
    },
  };
}
