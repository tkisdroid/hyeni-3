/**
 * 부모 홈 구독 카드의 플랜 라벨 namespace 회귀.
 *
 * 왜 별도 테스트인가: 카드 설명은 `entitlement.planLabelId`(= `billing.subscription.plan.*`)가
 * transform 을 거쳐 흘러오므로, 화면 소스에서 message id 를 정적으로 추론하는 기존 배선 검사
 * (`tests/i18nUiWiring.test.mjs`)가 이 의존을 보지 못한다. 실제로 2026-08-25 A17 실기기에서
 * `#/parent/home` 이 `billing.subscription.plan.annual` 을 **원시 id 그대로** 표시했다.
 *
 * 그래서 여기서는 "부모 홈 라우트가 billing namespace 를 선언한다"와
 * "플랜 라벨 id 가 billing 카탈로그에 10개 locale 모두 존재한다"를 함께 고정한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const entitlementSource = await readFile(new URL("../src/transform/entitlement.ts", import.meta.url), "utf8");
const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

test("부모 홈 라우트는 구독 카드가 쓰는 billing namespace 를 선언한다", () => {
  const routeLine = appSource
    .split("\n")
    .find((line) => line.includes('path: "parent/home"'));
  assert.ok(routeLine, "parent/home 라우트를 찾지 못했습니다");

  const groupMatch = routeLine.match(/routeElement\(<ParentHome \/>,\s*([A-Z_]+)\)/);
  assert.ok(groupMatch, `parent/home 라우트의 namespace 그룹을 읽지 못했습니다: ${routeLine}`);
  const groupName = groupMatch[1];

  const declaration = appSource
    .split("\n")
    .find((line) => line.includes(`const ${groupName} =`));
  assert.ok(declaration, `${groupName} 선언을 찾지 못했습니다`);

  for (const namespace of ["core", "parent", "billing", "shared"]) {
    assert.ok(
      declaration.includes(`"${namespace}"`),
      `${groupName} 에 ${namespace} namespace 가 없습니다 — 콜드 스타트에서 원시 message id 가 보입니다`,
    );
  }
});

test("플랜 라벨 message id 는 billing 카탈로그에 10개 locale 모두 존재한다", async () => {
  const ids = [...entitlementSource.matchAll(/"(billing\.subscription\.plan\.[A-Za-z0-9.]+)"/g)]
    .map((match) => match[1]);
  assert.ok(ids.length >= 5, `플랜 라벨 id 를 찾지 못했습니다(${ids.length}개)`);

  for (const locale of LOCALES) {
    const catalog = JSON.parse(
      await readFile(new URL(`../locales/${locale}/billing.json`, import.meta.url), "utf8"),
    );
    for (const id of new Set(ids)) {
      const value = catalog[id];
      assert.equal(typeof value, "string", `${locale}: ${id} 누락`);
      assert.ok(value.trim().length > 0, `${locale}: ${id} 빈 값`);
    }
  }
});

test("entitlement 는 플랜 라벨 문구를 직접 만들지 않는다", () => {
  // 문구를 되돌리면 en/ja 화면에 한국어가 다시 새어 나온다.
  assert.doesNotMatch(entitlementSource, /return "(?:무료 플랜|프리미엄[^"]*)"/);
  assert.match(entitlementSource, /planLabelId/);
});
