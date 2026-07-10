import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// 상대 경로 base('./') → Capacitor(file://)와 PWA 모두에서 자원이 정상 로드됩니다.
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "favicon-32x32.png", "assets/logo.webp"],
      manifest: {
        name: "혜니캘린더",
        short_name: "혜니캘린더",
        description: "가족 일정 공유 + 부모·자녀 위치/안전",
        lang: "ko",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FBF7F4",
        theme_color: "#F76BA6",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,webp,png,svg}"],
        // Jua 는 유니코드 구간별 87개 서브셋(총 854KB)이라 전부 프리캐시하면 설치가 무거워진다.
        // 브라우저가 실제로 쓰는 구간만 내려받게 두고, 네이티브는 어차피 로컬 파일이라 영향이 없다.
        globIgnores: ["**/fonts/jua/**"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
  build: { target: "es2022", sourcemap: false },
});
