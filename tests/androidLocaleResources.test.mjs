/**
 * Android locale 리소스 회귀.
 *
 * 앱 이름·전체화면 문구는 웹 카탈로그가 아니라 Android XML 이 렌더한다. 그래서 `locales/*&#47;android.json`
 * 만 채우고 XML 을 다시 만들지 않으면 런처와 잠금화면은 계속 한국어로 남는다.
 *
 * 특히 잘 깨지는 지점을 고정한다.
 *  · Android 리소스 수식자는 BCP-47 이 아니다(지역은 `zh-rCN`, Indonesian 은 legacy `in`).
 *  · Play 앱 이름은 30자 제한이라 부제가 길어지면 스토어 등록이 막힌다.
 *  · `%1$d` 서식 인자가 한 locale 에서만 빠지면 Android lint 가 실패한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ANDROID_RESOURCE_MAP,
  androidResourceQualifier,
  androidValuesDirName,
  buildAndroidResources,
  escapeAndroidString,
  verifySourceStringsXml,
} from "../scripts/i18n/generate-android-locales.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const resDir = join(rootDir, "android", "app", "src", "main", "res");
const PLAY_APP_NAME_LIMIT = 30;

test("리소스 수식자는 Android 규칙(지역 r 접두사·Indonesian legacy 코드)을 따른다", () => {
  assert.equal(androidResourceQualifier("ko"), "ko");
  assert.equal(androidResourceQualifier("zh-CN"), "zh-rCN");
  assert.equal(androidResourceQualifier("zh-TW"), "zh-rTW");
  // ISO 639-1 은 id 지만 Android 리소스는 in 이다. values-id 로 두면 매칭되지 않을 수 있다.
  assert.equal(androidResourceQualifier("id"), "in");
  assert.equal(androidValuesDirName("ja"), "values-ja");
  assert.equal(androidValuesDirName("id"), "values-in");
});

test("소스 locale 문구는 기본 values/strings.xml 과 정확히 일치한다", async () => {
  const mismatches = await verifySourceStringsXml();
  assert.deepEqual(mismatches, [], `정본이 두 개로 갈렸습니다:\n${mismatches.join("\n")}`);
});

test("비한국어 locale 리소스 파일이 모두 존재하고 매핑된 문자열을 전부 담는다", async () => {
  const { files } = await buildAndroidResources();
  const resourceNames = Object.values(ANDROID_RESOURCE_MAP);
  assert.ok(resourceNames.length >= 3, "매핑된 리소스가 너무 적습니다");

  for (const { locale, entries } of files) {
    if (locale === "ko") continue; // 기본 values/ 가 담당
    const path = join(resDir, androidValuesDirName(locale), "strings.xml");
    assert.ok(existsSync(path), `${locale}: ${path} 없음 — npm run i18n:android 를 실행하세요`);
    const xml = await readFile(path, "utf8");
    for (const [name, value] of entries) {
      assert.ok(
        xml.includes(`<string name="${name}">${escapeAndroidString(value)}</string>`),
        `${locale}: ${name} 값이 XML 과 다릅니다`,
      );
    }
  }
});

test("앱 이름은 Play 30자 제한을 넘지 않고 고유명 Hyeni 를 유지한다", async () => {
  const { files } = await buildAndroidResources();
  for (const { locale, entries } of files) {
    const appName = entries.find(([name]) => name === "app_name")?.[1];
    assert.equal(typeof appName, "string", `${locale}: app_name 누락`);
    assert.ok(
      appName.length <= PLAY_APP_NAME_LIMIT,
      `${locale}: 앱 이름 ${appName.length}자 — Play 제한 ${PLAY_APP_NAME_LIMIT}자 초과 (${appName})`,
    );
    if (locale !== "ko") {
      assert.ok(appName.includes("Hyeni"), `${locale}: 앱 이름에 고유명 Hyeni 가 없습니다`);
    }
  }
});

test("서식 인자는 10개 locale 에서 동일하게 유지된다", async () => {
  const { files } = await buildAndroidResources();
  const korean = files.find(({ locale }) => locale === "ko");
  assert.ok(korean, "ko 리소스를 찾지 못했습니다");
  const tokensOf = (value) => (value.match(/%\d+\$[a-z]/g) ?? []).sort().join(",");
  const expected = new Map(korean.entries.map(([name, value]) => [name, tokensOf(value)]));

  for (const { locale, entries } of files) {
    for (const [name, value] of entries) {
      assert.equal(tokensOf(value), expected.get(name), `${locale}: ${name} 서식 인자 불일치`);
    }
  }
});

test("locales_config.xml 은 10개 locale 을 BCP-47 로 선언한다", async () => {
  const xml = await readFile(join(resDir, "xml", "locales_config.xml"), "utf8");
  const manifest = JSON.parse(await readFile(join(rootDir, "locales", "manifest.json"), "utf8"));
  assert.equal(manifest.locales.length, 10);
  for (const { androidLocale } of manifest.locales) {
    assert.ok(
      xml.includes(`<locale android:name="${androidLocale}"/>`),
      `locales_config 에 ${androidLocale} 선언이 없습니다`,
    );
  }
});

test("AndroidManifest 는 localeConfig 를 참조한다", async () => {
  const xml = await readFile(join(rootDir, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  assert.match(xml, /android:localeConfig="@xml\/locales_config"/);
});
