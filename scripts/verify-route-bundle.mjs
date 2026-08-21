import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  inspectRouteEntryBundle,
  inspectRouteEntryStyles,
} from "./lib/routeBundleBudget.mjs";
import { inspectPwaPrecacheManifest } from "./lib/pwaPrecacheManifest.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");
const result = inspectRouteEntryBundle({ distDir });
const styles = inspectRouteEntryStyles({ distDir });
const pwa = inspectPwaPrecacheManifest({ distDir });
const callbackHtml = readFileSync(resolve(distDir, "oauth", "callback.html"), "utf8");
if (!callbackHtml.includes(`src="/${result.entryFile}"`)) {
  throw new Error(`OAuth 콜백 엔트리가 현재 진입 번들(${result.entryFile})을 참조하지 않습니다.`);
}
if (!callbackHtml.includes('<base href="/" />')) {
  throw new Error("OAuth 콜백 엔트리의 Service Worker 기준 경로가 루트가 아닙니다.");
}

console.log(
  `[번들 예산] ${result.entryFile}: ${result.bytes}/${result.limitBytes}바이트 (통과)`,
);
for (const file of result.files) {
  console.log(`[초기 자체 JS] ${file.file}: ${file.bytes}바이트 (예산 포함)`);
}
for (const file of result.excludedFiles) {
  console.log(`[초기 외부 JS] ${file.file}: ${file.bytes}바이트 (${file.reason}, 예산 제외)`);
}
console.log(
  `[초기 CSS 예산] ${styles.entryFile}: ${styles.bytes}/${styles.limitBytes}바이트 (통과)`,
);
console.log(`[PWA precache] ${pwa.swFile}: ${pwa.entries}개 URL, 중복 없음 (통과)`);
console.log(`[OAuth callback] ${result.entryFile} 참조·물리 엔트리 확인 (통과)`);
