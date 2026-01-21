// client/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 👇 proxy everything that starts with /api or /auth
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
        // Vite already forwards cookies, but we keep it explicit:
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req, res) => {
            const cookie = req.headers.cookie;
            if (cookie) proxyReq.setHeader("Cookie", cookie);
          });
        },
      },
      "/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req, res) => {
            const cookie = req.headers.cookie;
            if (cookie) proxyReq.setHeader("Cookie", cookie);
          });
        },
      },
    },
  },
});
