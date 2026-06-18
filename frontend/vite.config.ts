import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: {
        name: "ThoughtTracker",
        short_name: "ThoughtTracker",
        description:
          "Evidence-backed transcript analysis for YouTube creators.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="%232563eb"/><path d="M96 32 L132 104 H112 V160 H80 V104 H60 Z" fill="white"/></svg>',
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="84" fill="%232563eb"/><path d="M256 85 L352 277 H299 V427 H213 V277 H160 Z" fill="white"/></svg>',
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        /* Sensible offline cache for static assets; do NOT cache the API. */
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              ["script", "style", "font", "image"].includes(
                request.destination,
              ),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "tt-static" },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  build: {
    /*
     * Bundle-size budget: any single chunk crossing 500 KB raises a
     * warning at build time. A recruiter cloning the repo and running
     * `npm run build` should see a clean build with no oversize chunks;
     * if Recharts or react-query ever blow this budget we want to know
     * immediately so we can split the chunk.
     */
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        /*
         * Split heavy vendor chunks (charts, query, router) into their
         * own files so the initial bundle stays small and the
         * chunks can be HTTP-cached aggressively across deploys
         * (we ship hashed filenames).
         */
        manualChunks: {
          recharts: ["recharts"],
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
