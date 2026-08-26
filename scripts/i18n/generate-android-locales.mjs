/**
 * Android locale 리소스 생성기.
 *
 * 정본은 `locales/<locale>/android.json` 이고, 여기서 `android/app/src/main/res/values-<코드>/strings.xml`
 * 와 `res/xml/locales_config.xml`(Android 13+ 앱별 언어 목록)을 만든다.
 * 손으로 XML 을 고치면 10개 언어가 곧 어긋나므로 항상 이 스크립트를 통한다.
 *
 * 왜 폴더 이름을 따로 계산하는가
 *  - Android 리소스 수식자는 BCP-47 이 아니다. 지역은 `r` 접두사를 붙여 `zh-rCN` 으로 쓴다.
 *  - Indonesian 은 ISO 639-1 이 `id` 지만 Android 는 legacy 코드 `in` 을 쓴다.
 *    `values-id` 로 두면 기기 언어가 인도네시아어일 때 매칭되지 않을 수 있다.
 *  - 기본 `values/` 는 한국어(소스 locale)를 유지한다. 따라서 `values-ko` 는 만들지 않는다.
 *
 * 사용
 *   node scripts/i18n/generate-android-locales.mjs           # 생성
 *   node scripts/i18n/generate-android-locales.mjs --check    # 최신 여부만 검사(CI·테스트)
 */
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resDir = join(rootDir, "android", "app", "src", "main", "res");
const SOURCE_LOCALE = "ko";

/** catalog id → Android string 리소스 이름. 여기 없는 id 는 XML 로 나가지 않는다. */
export const ANDROID_RESOURCE_MAP = Object.freeze({
  "android.appName": "app_name",
  "android.appTitle": "title_activity_main",
  "android.pushDefaultTitle": "push_alert_default_title",
  "android.forceRing.title": "force_ring_title",
  "android.forceRing.messageLabel": "force_ring_message_label",
  "android.forceRing.acknowledge": "force_ring_acknowledge",
  "android.forceRing.footer": "force_ring_footer",
  "android.forceRing.countdown": "force_ring_countdown",
  "android.pushAlert.close": "push_alert_close",
  "android.pushAlert.openApp": "push_alert_open_app",
});

/** Android 리소스 수식자. BCP-47 과 다른 지점을 여기서 한 번만 처리한다. */
export function androidResourceQualifier(locale) {
  if (locale === "id") return "in"; // Android legacy 코드
  const [language, region] = String(locale).split("-");
  return region ? `${language}-r${region}` : language;
}

export function androidValuesDirName(locale) {
  return `values-${androidResourceQualifier(locale)}`;
}

/** XML 텍스트 노드 이스케이프. `%` 서식 인자는 원문을 보존한다. */
export function escapeAndroidString(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderStringsXml(locale, entries) {
  const rows = entries
    .map(([name, value]) => `    <string name="${name}">${escapeAndroidString(value)}</string>`)
    .join("\n");
  return [
    "<?xml version='1.0' encoding='utf-8'?>",
    `<!-- 생성물: scripts/i18n/generate-android-locales.mjs (정본 locales/${locale}/android.json). 직접 고치지 않는다. -->`,
    "<resources>",
    rows,
    "</resources>",
    "",
  ].join("\n");
}

export function renderLocalesConfigXml(locales) {
  const rows = locales
    .map((locale) => `    <locale android:name="${locale}"/>`)
    .join("\n");
  return [
    "<?xml version='1.0' encoding='utf-8'?>",
    "<!-- 생성물: scripts/i18n/generate-android-locales.mjs. Android 13+ 앱별 언어 목록이다. -->",
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">',
    rows,
    "</locale-config>",
    "",
  ].join("\n");
}

async function readManifest() {
  return JSON.parse(await readFile(join(rootDir, "locales", "manifest.json"), "utf8"));
}

async function readAndroidCatalog(locale) {
  return JSON.parse(await readFile(join(rootDir, "locales", locale, "android.json"), "utf8"));
}

/** locale 별 (리소스 이름, 값) 목록. 소스에 있는 id 만 내보낸다. */
export async function buildAndroidResources() {
  const manifest = await readManifest();
  const source = await readAndroidCatalog(SOURCE_LOCALE);
  const sourceIds = Object.keys(source).filter((id) => Object.hasOwn(ANDROID_RESOURCE_MAP, id));
  const files = [];
  for (const { code } of manifest.locales) {
    const catalog = await readAndroidCatalog(code);
    const entries = sourceIds.map((id) => {
      const value = catalog[id];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`android 문구 누락: ${code}:${id}`);
      }
      return [ANDROID_RESOURCE_MAP[id], value];
    });
    files.push({ locale: code, entries });
  }
  return { manifest, sourceIds, files };
}

/**
 * 기본 `values/strings.xml` 은 손으로 유지한다(기술 값과 이모지가 섞여 있어 카탈로그 대상이 아니다).
 * 대신 소스 locale 문구가 카탈로그와 어긋나지 않는지 확인해 정본이 두 개가 되는 것을 막는다.
 */
export async function verifySourceStringsXml() {
  const path = join(resDir, "values", "strings.xml");
  const xml = await readFile(path, "utf8");
  const source = await readAndroidCatalog(SOURCE_LOCALE);
  const mismatches = [];
  for (const [id, resourceName] of Object.entries(ANDROID_RESOURCE_MAP)) {
    const expected = source[id];
    if (typeof expected !== "string") continue;
    const match = xml.match(new RegExp(`<string name="${resourceName}"[^>]*>([\\s\\S]*?)</string>`));
    if (!match) {
      mismatches.push(`${resourceName}: values/strings.xml 에 없음`);
      continue;
    }
    // XML 이스케이프를 되돌려 카탈로그 원문과 비교한다.
    const actual = match[1]
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'");
    if (actual !== expected) {
      mismatches.push(`${resourceName}: XML="${actual}" != 카탈로그="${expected}"`);
    }
  }
  return mismatches;
}

async function main() {
  const check = process.argv.includes("--check");
  const { manifest, sourceIds, files } = await buildAndroidResources();
  if (sourceIds.length === 0) {
    console.log("android 카탈로그가 비어 있어 생성할 리소스가 없습니다.");
    return;
  }

  const sourceMismatches = await verifySourceStringsXml();
  if (sourceMismatches.length > 0) {
    console.error("기본 values/strings.xml 이 ko 카탈로그와 어긋납니다:");
    for (const line of sourceMismatches) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  const expected = new Map();
  for (const { locale, entries } of files) {
    if (locale === SOURCE_LOCALE) continue; // 기본 values/ 가 소스 locale 을 담당한다
    expected.set(join(resDir, androidValuesDirName(locale), "strings.xml"), renderStringsXml(locale, entries));
  }
  expected.set(
    join(resDir, "xml", "locales_config.xml"),
    renderLocalesConfigXml(manifest.locales.map(({ androidLocale }) => androidLocale)),
  );

  const stale = [];
  for (const [path, content] of expected) {
    const current = existsSync(path) ? await readFile(path, "utf8") : null;
    if (current === content) continue;
    stale.push(path);
    if (!check) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }

  // 예상 밖 values-* 는 손으로 만든 잔재다. check 에서는 실패로, 생성에서는 제거로 닫는다.
  const managedDirs = new Set(
    files.filter(({ locale }) => locale !== SOURCE_LOCALE).map(({ locale }) => androidValuesDirName(locale)),
  );
  const unexpected = [];
  for (const entry of await readdir(resDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^values-/.test(entry.name)) continue;
    if (entry.name === "values-night") continue;
    if (managedDirs.has(entry.name)) continue;
    unexpected.push(entry.name);
    if (!check) await rm(join(resDir, entry.name), { recursive: true, force: true });
  }

  if (check) {
    if (stale.length || unexpected.length) {
      console.error(`Android locale 리소스가 최신이 아닙니다. stale=${stale.length} 예상 밖=${unexpected.join(",") || "없음"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Android locale 리소스 ${expected.size}개 최신 상태`);
    return;
  }
  console.log(`Android locale 리소스 ${expected.size}개 생성 완료 (문자열 ${sourceIds.length}종)`);
  if (unexpected.length) console.log(`예상 밖 폴더 제거: ${unexpected.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`
  || process.argv[1]?.endsWith("generate-android-locales.mjs")) {
  await main();
}
