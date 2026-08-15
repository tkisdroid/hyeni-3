import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  const syncBlock = functionBlock(bootstrap, "export async function syncNativeAppLocale");

  assert.doesNotMatch(selector, /syncNativeAppLocale|AppLocale/);
  assert.match(syncBlock, /if \(!isNativePlatform\(\)\) return/);
  assert.match(syncBlock, /getNativePlugin<AppLocalePlugin>\("AppLocale"\)/);
  assert.match(syncBlock, /await plugin\.setLocale\(\{ locale \}\)/);
  assert.doesNotMatch(syncBlock, forbiddenSessionMutations);
  assert.match(bootstrap, /void syncNativeAppLocale\(locale\)\.catch\(/);
  assert.match(bootstrap, /\}, \[locale\]\)/);
});
