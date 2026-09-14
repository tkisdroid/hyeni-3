/** 알림 문구 한 정본에서 웹/PWA와 Android가 동일한 카탈로그를 사용한다. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { definitions } from "../../shared/notificationDefinitions.ts";

const root = resolve(import.meta.dirname, "../..");
const source = JSON.parse(readFileSync(resolve(root, "locales/notification-messages.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "locales/manifest.json"), "utf8"));
const expectedLocales = manifest.locales.map(item => item.code).sort();
if (JSON.stringify(Object.keys(source.locales).sort()) !== JSON.stringify(expectedLocales)) throw Error("알림 언어 집합 불일치");
const placeholders = value => [...String(value).matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort().join(",");
const keys = Object.keys(source.locales.ko).sort();
for (const [locale, messages] of Object.entries(source.locales)) {
  if (JSON.stringify(Object.keys(messages).sort()) !== JSON.stringify(keys)) throw Error(`알림 키 불일치: ${locale}`);
  for (const key of keys) {
    if (typeof messages[key] !== "string" || !messages[key].trim() || placeholders(messages[key]) !== placeholders(source.locales.ko[key])) throw Error(`알림 매개변수 불일치: ${locale}:${key}`);
  }
}
const outputs = {
  "shared/generated/notificationCatalog.ts": "/** 생성물: locales/notification-messages.json에서 생성한다. */\nexport const notificationCatalog = " + JSON.stringify(source.locales, null, 2) + " as const;\n",
  "android/app/src/main/assets/notification-messages.json": JSON.stringify({ definitions, locales: source.locales }) + "\n",
};
for (const [relative, content] of Object.entries(outputs)) {
  const path = resolve(root, relative);
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw Error(`알림 생성물 갱신 필요: ${relative}`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
}
console.log(`알림 카탈로그 ${expectedLocales.length}개 언어 검증 통과`);
