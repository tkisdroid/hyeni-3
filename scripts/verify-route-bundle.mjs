import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRouteEntryBundle } from "./lib/routeBundleBudget.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = inspectRouteEntryBundle({ distDir: resolve(rootDir, "dist") });

console.log(
  `[번들 예산] ${result.entryFile}: ${result.bytes}/${result.limitBytes}바이트 (통과)`,
);
