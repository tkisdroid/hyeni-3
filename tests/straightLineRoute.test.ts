// 경로 실패 시 정직한 강등 회귀(2026-08-17 실사고).
//
// 상류 라우팅이 죽어도 좌표는 둘 다 있다 — 직선 거리만이라도 알려준다.
// 단 "직선"임을 반드시 밝히고, 경로·턴바이턴을 지어내지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { straightLineHint } from "../src/transform/straightLineRoute.ts";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"] as const;

test("직선 거리와 도보 환산 분을 계산한다", () => {
  // 동탄 인근 약 550m 구간.
  const hint = straightLineHint({ lat: 37.2005, lng: 127.0745 }, { lat: 37.2045, lng: 127.0782 });
  assert.ok(hint);
  assert.ok(hint.distanceM > 400 && hint.distanceM < 700, `거리 이상: ${hint.distanceM}`);
  assert.ok(hint.minutes >= 1);
  // 같은 지점이면 0m 이지만 시간은 최소 1분으로 올린다(0분은 말이 안 된다).
  const same = straightLineHint({ lat: 37.2, lng: 127.07 }, { lat: 37.2, lng: 127.07 });
  assert.deepEqual(same, { distanceM: 0, minutes: 1 });
});

test("좌표가 없거나 유효하지 않으면 숫자를 지어내지 않는다", () => {
  assert.equal(straightLineHint(null, { lat: 37.2, lng: 127.07 }), null);
  assert.equal(straightLineHint({ lat: 37.2, lng: 127.07 }, null), null);
  assert.equal(straightLineHint(undefined, undefined), null);
  // Number(null)===0 함정 — 적도·본초자오선 좌표를 만들어 내면 안 된다.
  for (const bad of [null, undefined, NaN, "37.2"]) {
    assert.equal(straightLineHint({ lat: bad, lng: 127.07 } as never, { lat: 37.2, lng: 127.07 }), null);
    assert.equal(straightLineHint({ lat: 37.2, lng: 127.07 }, { lat: 37.2, lng: bad } as never), null);
  }
});

test("아이·부모 화면 모두 경로 실패 시 직선 거리를 보여준다", () => {
  const sheet = read("src/screens/child/overlays/RouteSheet.tsx");
  assert.match(sheet, /straightLineHint\(origin, destination\)/);
  assert.match(sheet, /id: "child\.route\.straightLine"/);
  const view = read("src/screens/feature/RouteView.tsx");
  assert.match(view, /straightLineHint\(origin, destination\?\.point \?\? null\)/);
  assert.match(view, /id: "shared\.routeView\.straightLine"/);
});

test("문구는 직선임을 밝히고 10개 locale 에 모두 있다", () => {
  for (const locale of LOCALES) {
    const child = JSON.parse(read(`locales/${locale}/child.json`)) as Record<string, string>;
    const shared = JSON.parse(read(`locales/${locale}/shared.json`)) as Record<string, string>;
    assert.ok((child["child.route.straightLine"] ?? "").trim().length > 0, `${locale} child 누락`);
    assert.ok((shared["shared.routeView.straightLine"] ?? "").trim().length > 0, `${locale} shared 누락`);
  }
  // 한국어는 "직선"을 명시해야 지어낸 경로로 오해하지 않는다.
  const ko = JSON.parse(read("locales/ko/child.json")) as Record<string, string>;
  assert.match(ko["child.route.straightLine"], /직선/);
  const koShared = JSON.parse(read("locales/ko/shared.json")) as Record<string, string>;
  assert.match(koShared["shared.routeView.straightLine"], /직선/);
  // 아이 화면은 반말이다.
  assert.doesNotMatch(ko["child.route.straightLine"], /습니다|하세요|해요/);
});
