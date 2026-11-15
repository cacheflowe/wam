import basicSsl from "@vitejs/plugin-basic-ssl";
import wamPresetStore from "./vite-plugins/wam-preset-store.js";

export default {
  plugins: [basicSsl(), wamPresetStore()],
  server: {
    host: true,
    port: "8005",
    https: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
};
