// client/vite.config.js
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), "");

  // Determine backend URL based on environment
  // If VITE_API_URL is set, use it; otherwise default to localhost
  const apiUrl = env.VITE_API_URL || "http://localhost:3000";
  const isProductionBackend = apiUrl.includes("onrender.com");

  console.log(`Frontend proxying to: ${apiUrl}`);

  return {
    plugins: [react()],
    server: {
      // 👇 proxy everything that starts with /api or /auth
      proxy: {
        "/api": {
          target: apiUrl,
          changeOrigin: true,
          secure: isProductionBackend, // Use HTTPS for production
          // Vite already forwards cookies, but we keep it explicit:
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req, res) => {
              const cookie = req.headers.cookie;
              if (cookie) proxyReq.setHeader("Cookie", cookie);
            });
          },
        },
        "/auth": {
          target: apiUrl,
          changeOrigin: true,
          secure: isProductionBackend, // Use HTTPS for production
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req, res) => {
              const cookie = req.headers.cookie;
              if (cookie) proxyReq.setHeader("Cookie", cookie);
            });
          },
        },
      },
    },
  };
});
