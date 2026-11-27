import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        embed: resolve(__dirname, "src/embed.jsx"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "embed" ? "widget-embed.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name && assetInfo.name.endsWith(".css")
            ? "widget-embed.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
