import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { initialChunkProvenancePlugin } from "./scripts/vite/initialChunkProvenancePlugin.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const packageMetadata = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

// 상대 경로 base('./') → Capacitor(file://)와 PWA 모두에서 자원이 정상 로드됩니다.
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // 새 Worker는 받되 결제·원격청취·미저장 편집이 끝난 뒤에만 활성화한다.
      registerType: "prompt",
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
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,webp,png,svg}"],
        // Jua 는 유니코드 구간별 87개 서브셋(총 854KB)이라 전부 프리캐시하면 설치가 무거워진다.
        // 브라우저가 실제로 쓰는 구간만 내려받게 두고, 네이티브는 어차피 로컬 파일이라 영향이 없다.
        globIgnores: [
          "**/fonts/jua/**",
          // 아래 파일은 includeAssets/manifest 아이콘 경로가 revision 포함 항목으로 따로 주입한다.
          // glob에서도 다시 수집하면 같은 URL이 두 revision으로 겹쳐 Service Worker 평가가 실패한다.
          "**/apple-touch-icon.png",
          "**/favicon-32x32.png",
          "**/pwa-192x192.png",
          "**/pwa-512x512.png",
          "**/pwa-maskable-512x512.png",
          "**/assets/logo.webp",
          // 정적·동적 앱 참조와 manifest에 없는 레거시 자산은 설치 precache에서 제외한다.
          "**/assets/family/daughter.webp",
          "**/assets/status/busy.webp",
          "**/assets/status/danger.webp",
          "**/assets/status/happy.webp",
          "**/assets/status/late.webp",
          "**/assets/status/love.webp",
          "**/assets/status/scheduled.webp",
          "**/assets/ui/gift.webp",
          "**/assets/ui/pin-lavender.webp",
          "**/assets/ui/place-frequent.webp",
          "**/assets/ui/rainbow.webp",
          "**/pwa-180x180.png",
        ],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
    initialChunkProvenancePlugin({ rootDir }),
  ],
  server: { port: 5173, host: true },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          "i18n-runtime": [
            "react",
            "react-dom",
            "react-dom/client",
            "react-intl",
            "intl-messageformat",
          ],
        },
      },
    },
  },
});
