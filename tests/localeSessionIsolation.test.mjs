import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenSessionMutations = /clearApiSession|logout|setActiveChildId\s*\(\s*null\s*\)|anonymousLogin/;

function read(relativePath) {
  const path = resolve(rootDir, relativePath);
  assert.equal(existsSync(path), true, `${relativePath} 파일이 필요합니다`);
  return readFileSync(path, "utf8");
}

function functionBlock(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} 구현이 필요합니다`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${signature} 함수 끝을 찾을 수 없습니다`);
  return source.slice(start, end + 3);
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function loadNativeLocaleSync(plugin) {
  const pluginKey = `__hyeniLocalePlugin_${crypto.randomUUID().replaceAll("-", "")}`;
  globalThis[pluginKey] = plugin;
  const server = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
    plugins: [{
      name: "native-locale-plugin-test-double",
      enforce: "pre",
      resolveId(id) {
        if (id === "@/lib/native/plugins" || id.endsWith("/lib/native/plugins")) {
          return "\0native-locale-plugin-test-double";
        }
      },
      load(id) {
        if (id !== "\0native-locale-plugin-test-double") return undefined;
        return `
          export const isNativePlatform = () => true;
          export const getNativePlugin = () => globalThis.${pluginKey};
        `;
      },
    }],
  });
  const module = await server.ssrLoadModule("/src/app/NativeBootstrap.tsx");
  return {
    syncNativeAppLocale: module.syncNativeAppLocale,
    async close() {
      delete globalThis[pluginKey];
      await server.close();
    },
  };
}

test("언어 선택은 locale runtime만 호출하고 인증·활성 아이 세션을 바꾸지 않는다", () => {
  const selector = read("src/components/LanguageSelector.tsx");

  assert.match(selector, /const \{ locale, setLocale \} = useLocale\(\)/);
  assert.match(selector, /onClick=\{\(\) => void setLocale\(entry\.code\)\}/);
  assert.doesNotMatch(selector, forbiddenSessionMutations);
  assert.doesNotMatch(selector, /hyeni-api-session-v1|hyeni-active-child|AuthProvider|QueryProvider/);
});

test("locale 저장은 전용 기기 키만 사용하고 계정 저장소에 쓰지 않는다", () => {
  const storage = read("src/i18n/localeStorage.ts");
  const provider = read("src/i18n/LocaleProvider.tsx");

  assert.match(storage, /LOCALE_STORAGE_KEY/);
  assert.match(provider, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/);
  assert.doesNotMatch(`${storage}\n${provider}`, /hyeni-api-session-v1|hyeni-active-child/);
  assert.doesNotMatch(provider, forbiddenSessionMutations);
});

test("Android locale 동기화 실패는 이미 완료된 웹 locale 전환을 되돌리지 않는다", () => {
  const selector = read("src/components/LanguageSelector.tsx");
  const bootstrap = read("src/app/NativeBootstrap.tsx");
  const syncBlock = functionBlock(bootstrap, "export function syncNativeAppLocale");

  assert.doesNotMatch(selector, /syncNativeAppLocale|AppLocale/);
  assert.match(bootstrap, /createNativeLocaleSyncScheduler/);
  assert.match(bootstrap, /if \(!isNativePlatform\(\)\) return/);
  assert.match(bootstrap, /getNativePlugin<AppLocalePlugin>\("AppLocale"\)/);
  assert.match(bootstrap, /await plugin\.setLocale\(\{ locale \}\)/);
  assert.match(bootstrap, /console\.warn\("native_locale_sync_failed"\)/);
  assert.match(syncBlock, /return nativeAppLocaleScheduler\.request\(locale\)/);
  assert.doesNotMatch(syncBlock, forbiddenSessionMutations);
  assert.match(bootstrap, /void syncNativeAppLocale\(locale\)/);
  assert.match(bootstrap, /\}, \[locale\]\)/);
});

test("A 동기화가 끝날 때까지 B를 시작하지 않고 마지막 native locale을 B로 맞춘다", async () => {
  const a = deferred();
  const started = [];
  const applied = [];
  const runtime = await loadNativeLocaleSync({
    async setLocale({ locale }) {
      started.push(locale);
      if (locale === "en") await a.promise;
      applied.push(locale);
      return { locale };
    },
  });

  try {
    const first = runtime.syncNativeAppLocale("en");
    const second = runtime.syncNativeAppLocale("ja");
    await Promise.resolve();
    assert.deepEqual(started, ["en"]);

    a.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(started, ["en", "ja"]);
    assert.deepEqual(applied, ["en", "ja"]);
    assert.equal(applied.at(-1), "ja");
  } finally {
    a.resolve();
    await runtime.close();
  }
});

test("A native 동기화가 실패해도 대기 중인 B를 계속 적용한다", async () => {
  const a = deferred();
  const started = [];
  const applied = [];
  const runtime = await loadNativeLocaleSync({
    async setLocale({ locale }) {
      started.push(locale);
      if (locale === "en") await a.promise;
      applied.push(locale);
      return { locale };
    },
  });

  try {
    const first = runtime.syncNativeAppLocale("en");
    const second = runtime.syncNativeAppLocale("ja");
    a.reject(new Error("A 동기화 실패"));
    await Promise.all([first, second]);

    assert.deepEqual(started, ["en", "ja"]);
    assert.deepEqual(applied, ["ja"]);
  } finally {
    a.resolve();
    await runtime.close();
  }
});

test("빠른 A→B→C 요청은 대기 중인 B를 합치고 최종 C를 적용한다", async () => {
  const a = deferred();
  const started = [];
  const applied = [];
  const runtime = await loadNativeLocaleSync({
    async setLocale({ locale }) {
      started.push(locale);
      if (locale === "en") await a.promise;
      applied.push(locale);
      return { locale };
    },
  });

  try {
    const first = runtime.syncNativeAppLocale("en");
    const second = runtime.syncNativeAppLocale("ja");
    const third = runtime.syncNativeAppLocale("fil");
    await Promise.resolve();
    assert.deepEqual(started, ["en"]);

    a.resolve();
    await Promise.all([first, second, third]);
    assert.deepEqual(started, ["en", "fil"]);
    assert.deepEqual(applied, ["en", "fil"]);
    assert.equal(applied.at(-1), "fil");
  } finally {
    a.resolve();
    await runtime.close();
  }
});
