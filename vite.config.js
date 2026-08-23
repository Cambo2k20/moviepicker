import { defineConfig } from "vite";

export default defineConfig({
  base: "/moviepicker/",
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"]
  }
});
