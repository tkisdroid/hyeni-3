import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  effectiveLocationIntervalMode,
  normalizeLocationIntervalMode,
} = await import(pathToFileURL(resolve(workerDir, "lib/locationIntervalPolicy.ts")).href);

test.after(() => typeScriptResolutionHook.deregister());

test("Free·reviewed는 live를 balanced로 강등하고 Premium만 live를 유지한다", () => {
  assert.equal(effectiveLocationIntervalMode("live", false), "balanced");
  assert.equal(effectiveLocationIntervalMode("live", true), "live");
  assert.equal(effectiveLocationIntervalMode("saver", false), "saver");
  assert.equal(effectiveLocationIntervalMode("balanced", false), "balanced");
});

test("알 수 없는 위치 전송 모드는 안전한 balanced로 정규화한다", () => {
  assert.equal(normalizeLocationIntervalMode(null), "balanced");
  assert.equal(normalizeLocationIntervalMode(" fast "), "balanced");
  assert.equal(normalizeLocationIntervalMode(" saver "), "saver");
});
