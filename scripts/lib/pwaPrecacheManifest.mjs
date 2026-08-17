import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRECACHE_ENTRY_PATTERN = /"revision":(?:null|"[^"]*"),"url":"([^"]+)"/g;
const ADDITIONAL_PRECACHE_URLS = new Set([
  "apple-touch-icon.png",
  "favicon-32x32.png",
  "pwa-192x192.png",
  "pwa-512x512.png",
  "pwa-maskable-512x512.png",
  "assets/logo.webp",
  "manifest.webmanifest",
]);

function compareUrls(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function inspectPwaPrecacheManifest({ distDir }) {
  const swFile = "sw.js";
  const source = readFileSync(resolve(distDir, swFile), "utf8");
  const urls = [...source.matchAll(PRECACHE_ENTRY_PATTERN)].map((match) => match[1]);
  if (urls.length === 0) {
    throw new Error("[PWA precache] sw.js에서 precache 항목을 찾지 못했습니다.");
  }

  const counts = new Map();
  for (const url of urls) counts.set(url, (counts.get(url) ?? 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([url, count]) => `${url} (${count}회)`)
    .sort();
  if (duplicates.length > 0) {
    throw new Error(
      `[PWA precache] 중복 URL이 있어 Service Worker가 시작되지 않습니다: ${duplicates.join(", ")}`,
    );
  }

  const generatedUrls = urls.filter((url) => !ADDITIONAL_PRECACHE_URLS.has(url));
  const sortedGeneratedUrls = [...generatedUrls].sort(compareUrls);
  const firstUnstableIndex = generatedUrls.findIndex(
    (url, index) => url !== sortedGeneratedUrls[index],
  );
  if (firstUnstableIndex >= 0) {
    throw new Error(
      `[PWA precache] URL 순서가 결정적이지 않습니다: ${generatedUrls[firstUnstableIndex]}`,
    );
  }

  return {
    swFile,
    entries: urls.length,
  };
}
