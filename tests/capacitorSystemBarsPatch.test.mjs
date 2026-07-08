import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const patchScript = readFileSync(resolve(rootDir, "scripts/patch-capacitor-systembars.mjs"), "utf8");

test("Capacitor SystemBars 패치는 DOM 준비 전 safe area 콘솔 오류를 막는다", () => {
  assert.equal(packageJson.scripts.postinstall, "node scripts/patch-capacitor-systembars.mjs");
  assert.match(patchScript, /SystemBars\.java/);
  assert.match(patchScript, /if \(document\.documentElement\) \{/);
  assert.match(patchScript, /safe-area-inset-top/);
});
