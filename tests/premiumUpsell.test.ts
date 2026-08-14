import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePremiumUpsell } from "../src/transform/premiumUpsell.ts";

test("상황형 업셀은 한도와 기존 데이터 보존을 정확히 안내한다", () => {
  const place = resolvePremiumUpsell("saved_place");
  assert.match(place.title, /무료 알림 대상 2개/);
  assert.equal(place.usageLabel, "알림 2/2 사용");
  assert.match(place.description, /등록한 장소는 삭제되지 않/);
  assert.match(place.description, /무료 플랜 알림 대상은 생성 순 2개까지/);
  assert.match(place.description, /나머지는 프리미엄에서 다시 알림 대상/);
  assert.match(place.premiumValue, /제한 없이 추가/);
  assert.equal(place.ctaLabel, "장소 계속 추가하기");
  assert.equal(place.continueLabel, "무료로 계속 쓰기");

  const grandfatheredPlace = resolvePremiumUpsell("saved_place", { used: 3, limit: 3 });
  assert.match(grandfatheredPlace.title, /무료 알림 대상 3개/);
  assert.equal(grandfatheredPlace.usageLabel, "알림 3/3 사용");
  assert.match(grandfatheredPlace.description, /현재 플랜 알림 대상은 생성 순 3개까지/);
  assert.doesNotMatch(`${grandfatheredPlace.title} ${grandfatheredPlace.usageLabel}`, /2\/2|2개/);

  const overLimitPlace = resolvePremiumUpsell("saved_place", { used: 3, limit: 2 });
  assert.match(overLimitPlace.title, /무료 알림 대상 2개/);
  assert.equal(overLimitPlace.usageLabel, "알림 2/2 · 저장 3개");
  assert.doesNotMatch(overLimitPlace.usageLabel ?? "", /3\/2/);

  const child = resolvePremiumUpsell("second_child");
  assert.match(child.description, /첫째 아이의 연결과 데이터는 그대로 유지/);
  assert.match(child.description, /이미 연결된 아이는 구독이 끝나도 자동으로 해제하거나 숨기지 않/);
  assert.equal(child.ctaLabel, "둘째 아이 연결 계속하기");

  const danger = resolvePremiumUpsell("danger_zone");
  assert.match(danger.description, /등록한 위험구역은 삭제되지 않/);
  assert.match(danger.description, /무료 플랜 알림 대상은 생성 순 1개까지/);
  assert.match(danger.description, /나머지는 프리미엄에서 다시 알림 대상/);
  assert.doesNotMatch(`${danger.title} ${danger.description}`, /위험 알림.*유료|안전 알림.*유료/);
});

test("위치·리포트·AI·주변소리 업셀은 Free에서 유지되는 가치와 Premium 가치를 구분한다", () => {
  const location = resolvePremiumUpsell("location_request");
  assert.equal(location.usageLabel, "5/5 사용");
  assert.match(location.title, /최근 24시간/);
  assert.match(location.description, /약 10분 간격 자동 확인과 SOS·긴급 알림은 계속 작동/);
  assert.match(location.premiumValue, /최근 24시간.*횟수 제한 없이/);

  const history = resolvePremiumUpsell("location_history");
  assert.match(history.description, /무료에서는 오늘 경로/);
  assert.match(history.premiumValue, /최근 30일/);

  const liveInterval = resolvePremiumUpsell("location_live_interval");
  assert.match(liveInterval.description, /무료에서는 균형·절약 모드와 약 10분 간격/);
  assert.match(liveInterval.premiumValue, /실시간 모드/);

  const remote = resolvePremiumUpsell("remote_audio");
  assert.match(remote.description, /아이가 누르지 않아도 연결/);
  assert.match(remote.description, /아이 화면과 알림에 계속 표시/);
  assert.match(remote.description, /최대 1분 뒤 자동 종료/);
  assert.match(remote.description, /청취 기록/);

  assert.match(resolvePremiumUpsell("ai_daily_summary").premiumValue, /AI가 오늘의 일정·위치·안전 기록/);
  const aiFriendLimit = resolvePremiumUpsell("ai_friend_limit");
  assert.equal(aiFriendLimit.usageLabel, "5/5 사용");
  assert.match(aiFriendLimit.title, /무료 AI 친구 5회/);
  assert.match(aiFriendLimit.premiumValue, /하루 20회 기본 제공/);
  assert.match(aiFriendLimit.description, /SOS와 기본 안전 기능은 무료로 계속/);
  const aiScheduleLimit = resolvePremiumUpsell("ai_schedule_limit");
  assert.equal(aiScheduleLimit.usageLabel, "5/5 사용");
  assert.match(aiScheduleLimit.title, /오늘 무료 AI 일정 정리 5회/);
  assert.match(aiScheduleLimit.description, /직접 일정 추가와 기존 일정 관리는 무료에서도 제한 없이/);
  assert.match(aiScheduleLimit.description, /이미 저장한 일정도 그대로 유지/);
  assert.match(aiScheduleLimit.premiumValue, /AI 일정 정리를 하루 횟수 제한 없이/);
  assert.match(resolvePremiumUpsell("weekly_report").premiumValue, /주간 리포트 전체/);

  const academy = resolvePremiumUpsell("academy_schedule");
  assert.match(academy.description, /직접 일정 추가와 기존 일정 관리·메모·스티커는 무료에서도 제한 없이/);
  assert.match(academy.description, /준비물과 숙제는 모든 플랜에서 아이별 하루 각각 8개까지/);
  assert.doesNotMatch(academy.description, /준비물(?:과 숙제)?.*제한 없이/);

  const ring = resolvePremiumUpsell("remote_ring");
  assert.match(ring.title, /최근 24시간/);
  assert.match(ring.premiumValue, /최근 24시간.*10회/);

  const arrival = resolvePremiumUpsell("first_arrival");
  assert.match(arrival.description, /도착·출발 알림은 무료로 계속/);
  assert.match(arrival.premiumValue, /실시간 위치와 30일 이동 기록/);
  assert.doesNotMatch(`${arrival.title} ${arrival.description} ${arrival.premiumValue}`, /SOS.*프리미엄|긴급.*프리미엄/);
});

test("PremiumUpsell 컴포넌트는 기존 dialog 생명주기와 Android back을 사용한다", () => {
  const source = readFileSync(new URL("../src/components/PremiumUpsell.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/components/PremiumUpsell.css", import.meta.url), "utf8");

  assert.match(source, /useDialogFocusLifecycle/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /aria-describedby=\{descriptionId\}/);
  assert.match(source, /App\.addListener\("backButton"/);
  assert.match(source, /무료로 계속 쓰기/);
  assert.match(source, /aria-busy=\{busy\}/);
  assert.match(source, /resolvePremiumUpsell\(source, usage\)/);
  assert.match(source, /fetchWebBillingCatalog\(familyId\)/);
  assert.match(source, /catalog\.trialEligible === true && catalog\.trialDays === 7/);
  assert.match(source, /getPlatform\(\) !== "web"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\[aria-busy="true"\]:disabled/);
  assert.match(css, /opacity:\s*1/);
});
