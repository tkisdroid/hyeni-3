/**
 * 앱 소스(src/)를 Node 네이티브 TypeScript 로딩으로 import 하기 위한 resolve/load 훅.
 *
 * 앱 소스는 Vite 가 번들하므로 두 가지를 전제한다:
 *   ① `@/` 별칭(vite.config.ts 의 resolve.alias)
 *   ② 확장자 없는 상대 import (`from "./errors"`)
 *   ③ `import.meta.env`(Vite 가 빌드 시 치환)
 * Node ESM 은 셋 다 모르므로 그대로는 로드되지 않는다.
 *
 * 과거에는 이 간극을 Vite dev server(`ssrLoadModule`)로 메웠지만, 모듈 그래프를 SSR
 * 변환하느라 테스트 하나가 60초 `transport invoke timed out` 으로 실패하고 224초를
 * 잡아먹었다(2026-08-19 실측, tests/webBilling.test.ts). worker/tests 가 같은 이유로
 * Vite 를 걷어낸 것과 같은 처방이다 — worker/tests/helpers/tsModuleResolve.mjs 참고.
 *
 * 이 훅은 테스트 프로세스 안에서만 동작한다. 앱 소스와 Vite 빌드는 전혀 바뀌지 않으므로
 * 배포 산출물에 영향이 없다.
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = pathToFileURL(fileURLToPath(new URL("../../src/", import.meta.url))).href;

// 확장자를 이미 가진 specifier 는 건드리지 않는다.
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;
const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".js", "/index.ts", "/index.tsx", "/index.js"];

function resolveWithExtension(baseUrl) {
  if (HAS_EXTENSION.test(baseUrl.pathname) && existsSync(baseUrl)) return baseUrl.href;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = new URL(baseUrl.href + suffix);
    if (existsSync(candidate)) return candidate.href;
  }
  return null;
}

/**
 * Vite 가 빌드 시 치환하는 `import.meta.env` 를 테스트 프로세스에서 대신 채운다.
 * 실제 배포 기본값과 같게 두어야 client.ts 가 실서버 계약대로 URL 을 조립한다
 * (config/env.ts 는 미설정 시 prod Worker 로 폴백하므로 빈 값이 곧 기본값이다).
 */
globalThis.__HYENI_TEST_IMPORT_META_ENV__ = {
  MODE: "test",
  DEV: false,
  PROD: false,
  SSR: false,
  BASE_URL: "/",
};

/**
 * vite.config.ts 의 `define` 전역. Vite 가 빌드 시 상수로 치환하므로 Node 에는 없다.
 * 값의 출처를 package.json 으로 같게 두어 버전이 갈라지지 않게 한다.
 */
globalThis.__APP_VERSION__ = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = resolveWithExtension(new URL(specifier.slice(2), SRC_ROOT));
      if (resolved) return { url: resolved, format: undefined, shortCircuit: true };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../"))
      && !HAS_EXTENSION.test(specifier)
      && context.parentURL
    ) {
      const resolved = resolveWithExtension(new URL(specifier, context.parentURL));
      if (resolved) return { url: resolved, format: undefined, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(SRC_ROOT) || typeof result.source === "undefined") return result;
    const source = typeof result.source === "string"
      ? result.source
      : Buffer.from(result.source).toString("utf8");
    if (!source.includes("import.meta.env")) return result;
    return {
      ...result,
      source: source.replaceAll("import.meta.env", "globalThis.__HYENI_TEST_IMPORT_META_ENV__"),
    };
  },
});
