import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

console.log(
  `[번들 예산] ${result.entryFile}: ${result.bytes}/${result.limitBytes}바이트 (통과)`,
);
console.log(
  `[초기 CSS 예산] ${styles.entryFile}: ${styles.bytes}/${styles.limitBytes}바이트 (통과)`,
);
console.log(`[PWA precache] ${pwa.swFile}: ${pwa.entries}개 URL, 중복 없음 (통과)`);
