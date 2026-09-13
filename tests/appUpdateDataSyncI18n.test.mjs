import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const appUpdate = read("src/screens/feature/AppUpdate.tsx");
const dataSync = read("src/screens/feature/DataSync.tsx");
const main = read("src/main.tsx");
const coordinator = read("src/lib/pwaUpdateCoordinator.ts");
const koCore = JSON.parse(read("locales/ko/core.json"));
const koParent = JSON.parse(read("locales/ko/parent.json"));
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

function variables(message) {
  return [...message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .sort();
}

function koreanStringLiterals(path, code) {
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = [];
  const visit = (node) => {
    if (ts.isJsxText(node) && /[가-힣]/.test(node.text)) values.push(node.text.trim());
    if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) values.push(node.text);
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
      if (/[가-힣]/.test(text)) values.push(text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

test("업데이트와 데이터 동기화 화면은 사용자 문구를 Intl 카탈로그로만 렌더링한다", () => {
  assert.match(appUpdate, /const intl = useIntl\(\)/);
  assert.match(dataSync, /const intl = useIntl\(\)/);
  assert.deepEqual(koreanStringLiterals("AppUpdate.tsx", appUpdate), []);
  assert.deepEqual(koreanStringLiterals("DataSync.tsx", dataSync), []);
  assert.equal(koCore["core.appUpdate.title.formal"], "더 좋아진 혜니캘린더가 나왔어요");
  assert.equal(koParent["parent.dataSync.title"], "데이터 · 동기화");
});

test("앱 업데이트는 forced 정책과 대상 버전을 보존하고 역할별 말투로 스토어 실패를 알린다", () => {
  assert.match(appUpdate, /new URLSearchParams\(search\)/);
  assert.match(appUpdate, /get\("forced"\) === "1"/);
  assert.match(appUpdate, /get\("target"\)/);
  assert.match(appUpdate, /core\.appUpdate\.badgeVersion/);
  assert.match(appUpdate, /\{ version: targetVersion \}/);
  assert.match(appUpdate, /core\.appUpdate\.storeFailure\.child/);
  assert.match(appUpdate, /core\.appUpdate\.storeFailure\.formal/);
  assert.match(appUpdate, /openExternal\(STORE_URL\)\.catch/);
  assert.match(appUpdate, /\{!forced && \(/);
  assert.equal(koCore["core.appUpdate.required.child"], "이번 버전은 꼭 업데이트해야 계속 쓸 수 있어.");
  assert.equal(koCore["core.appUpdate.required.formal"], "이번 버전은 업데이트해야 계속 사용할 수 있어요.");
});

test("PWA 새 버전은 critical section 뒤 controller 교체를 확인하고 reload 실패를 재시도한다", () => {
  assert.match(main, /onNeedRefresh:\s*\(\)\s*=>\s*\{\s*queuePwaUpdateAction\("activate"/);
  assert.match(main, /pwaUpdateCoordinatorState\(\)\.criticalSectionCount > 0/);
  assert.match(main, /activatePwaUpdateAndWaitForControllerChange/);
  // 네이티브에서는 보고 있는 화면을 새로고침하지 않고 백그라운드로 갈 때 적용한다(2026-08-18).
  assert.match(main, /queuePwaUpdateAction\("reload", reloadForPwaUpdate\)/);
  assert.match(main, /function reloadForPwaUpdate\(\)[\s\S]{0,320}window\.location\.reload\(\)/);
  assert.match(coordinator, /catch \{[\s\S]*pendingActions\.set\(key, action\)/);
  assert.match(coordinator, /window|online|visibilitychange|retryPendingPwaUpdate/);
});

test("데이터 동기화는 두 서버 query의 실제 실패를 성공·빈 상태로 위장하지 않고 함께 재시도한다", () => {
  assert.match(dataSync, /resolveQueryTruthState\(\[/);
  assert.match(dataSync, /accountQuery\.isLoading, isError: accountQuery\.isError/);
  assert.match(dataSync, /familyQuery\.isLoading, isError: familyQuery\.isError/);
  assert.match(dataSync, /dataSyncQueryState === "error"/);
  const resyncStart = dataSync.indexOf("const resync = async");
  const exportStart = dataSync.indexOf("const exportJson", resyncStart);
  const resync = dataSync.slice(resyncStart, exportStart);
  assert.ok(resyncStart >= 0 && exportStart > resyncStart);
  assert.match(resync, /await qc\.invalidateQueries\(\)/);
  assert.match(resync, /Promise\.all\(\[[\s\S]*accountQuery\.refetch\(\)[\s\S]*familyQuery\.refetch\(\)[\s\S]*\]\)/);
  assert.match(resync, /accountResult\.isError \|\| familyResult\.isError/);
  assert.match(resync, /parent\.dataSync\.resync\.failed/);
  assert.match(resync, /parent\.dataSync\.resync\.success/);
  assert.match(dataSync, /confirmedDataTimestamp\(accountQuery\.dataUpdatedAt, familyQuery\.dataUpdatedAt\)/);
  assert.doesNotMatch(dataSync, /setSyncedAt|useState.*new Date/);
});

test("가족 수·확인 시각·내보내기 제외 수와 서버 원문은 번역하지 않고 값으로 보존한다", () => {
  assert.match(dataSync, /\{ count \}/);
  assert.match(dataSync, /\{ time: formattedSyncedAt \}/);
  assert.match(dataSync, /\{\s*errorCount:\s*errCount\s*\}/);
  assert.match(dataSync, /serializeDataExport\(result\)/);
  assert.match(dataSync, /result\.meta\.errors\.length/);
  assert.match(dataSync, /console\.error\("data_export_(?:file_save_)?failed", e\)/);
  assert.doesNotMatch(dataSync, /formatMessage\([\s\S]{0,160}\{\s*(?:result|account|family|e)\s*\}/);
});

test("업데이트·동기화 문구는 10개 locale에서 ID와 ICU 변수가 같고 영어 fallback이 없다", () => {
  const prefixes = ["core.appUpdate.", "parent.dataSync."];
  for (const prefix of prefixes) {
    const catalogs = Object.fromEntries(locales.map((locale) => {
      const namespace = prefix.startsWith("core.") ? "core" : "parent";
      return [locale, JSON.parse(read(`locales/${locale}/${namespace}.json`))];
    }));
    const ids = Object.keys(catalogs.en).filter((id) => id.startsWith(prefix)).sort();
    assert.ok(ids.length >= (prefix === "core.appUpdate." ? 12 : 30), `${prefix} 문구가 부족합니다`);
    for (const locale of locales) {
      const localeIds = Object.keys(catalogs[locale]).filter((id) => id.startsWith(prefix)).sort();
      assert.deepEqual(localeIds, ids, `${locale}:${prefix} ID가 다릅니다`);
      for (const id of ids) {
        const value = catalogs[locale][id];
        assert.equal(typeof value, "string", `${locale}:${id}`);
        assert.ok(value.trim(), `${locale}:${id}가 비었습니다`);
        assert.deepEqual(variables(value), variables(catalogs.en[id]), `${locale}:${id} ICU 변수가 다릅니다`);
        const languageBearingEnglish = catalogs.en[id].replace(/\{[^{}]+\}/g, "");
        if (locale !== "en" && /[A-Za-z]{3}/.test(languageBearingEnglish) && !/PWA|JSON/i.test(catalogs.en[id])) {
          assert.notEqual(value, catalogs.en[id], `${locale}:${id}가 영어 fallback입니다`);
        }
      }
    }
  }
});
