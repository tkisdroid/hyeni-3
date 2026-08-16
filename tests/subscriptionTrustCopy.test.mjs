import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/Subscription.tsx"), "utf8");
const locationSource = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const trialLockSource = readFileSync(resolve(rootDir, "src/screens/feature/TrialLock.tsx"), "utf8");
const koParent = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/parent.json"), "utf8"));

test("구독 화면은 SOS와 긴급 안전 알림을 무료 안전 기능으로 안내한다", () => {
  assert.doesNotMatch(source, /SOS 긴급 알림 우선 전송/);
  assert.match(source, /SOS와 긴급 안전 알림은 무료로 계속 제공돼요/);
  assert.match(source, /프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능/);
});

test("구독 화면은 프리미엄 혜택을 상세 안심과 편의 중심으로 설명한다", () => {
  assert.match(source, /다자녀 안심 관리/);
  assert.match(source, /장소·위험구역 무제한/);
  assert.match(source, /위치 이력/);
  assert.match(source, /AI 친구 기본 제공/);
  assert.match(source, /위치 끊김·미등록 체류/);
  assert.match(source, /학원 시간표 자동 정리/);
  assert.match(source, /아이 화면과 알림에 계속 표시되고 1분 뒤 자동 종료되며 청취 기록이 남아요/);
  assert.match(source, /Google Play에서 확인|시작하기/);
});

test("플랜 비교는 Free와 Premium 두 열만 표시하고 핵심 차이를 정책 함수에서 파생한다", () => {
  assert.match(source, /COMPARE_COLS: readonly Tier\[\] = \[TIERS\.FREE, TIERS\.PREMIUM\]/);
  assert.doesNotMatch(source, /COMPARE_COLS[^\n]*TIERS\.REVIEWED/);
  assert.match(source, /MAX_SUPPLY_ITEMS_PER_KIND/);
  assert.match(source, /일정·메모·스티커[\s\S]{0,100}무제한/);
  assert.match(source, /준비물·숙제[\s\S]{0,140}아이별 하루 각각.*MAX_SUPPLY_ITEMS_PER_KIND/);
  assert.doesNotMatch(source, /일정·준비물·메모·스티커[\s\S]{0,100}무제한/);
  assert.doesNotMatch(source, /준비물(?:·숙제)?[^\n]{0,100}(?:무제한|제한 없이)/);
  assert.match(source, /manualLocationRequestDailyLimitFor/);
  assert.match(source, /historyDaysFor/);
  assert.match(source, /placeLimitFor/);
  assert.match(source, /dangerZoneLimitFor/);
  assert.match(source, /forceRingDailyLimitFor/);
  assert.match(source, /aiFriendDailyBaseFor/);
  assert.match(source, /AI 일정 정리/);
  assert.match(source, /aiScheduleDailyLimitFor/);
  assert.match(source, /rolling24LimitLabel/);
  assert.match(source, /최근 24시간/);
  assert.match(source, /약 10분 간격 최신 실측/);
  assert.match(source, /오전 8시 기준 현재 안심일/);
  assert.match(source, /오늘의 안심 리포트[\s\S]{0,100}제공/);
  assert.match(source, /주간 가족 리포트[\s\S]{0,160}전체 보기[\s\S]{0,80}한 줄 미리보기/);
  assert.match(source, /위치 끊김·미등록 체류[\s\S]{0,160}자동 알림[\s\S]{0,80}수동 확인/);
  assert.match(source, /새 아이 연결 상한/);
  assert.match(source, /이미 연결된 아이는 구독이 끝나도 자동으로 해제하거나 숨기지 않아요/);
  assert.match(source, /구독 중 이미 저장한 한도 초과 장소·위험구역은 삭제되지 않고 관리할 수 있지만, 프리미엄을 다시 시작하기 전까지 알림 대상에서 제외돼요/);
  assert.ok((source.match(/DOWNGRADE_LIMIT_NOTICE/g) ?? []).length >= 3);
});

test("종료된 reviewed 혜택은 별도 판매 티어가 아니라 Free 현재 상태와 기존 장소 3곳으로 안내한다", () => {
  assert.match(source, /comparisonTier\s*=\s*tier === TIERS\.REVIEWED \? TIERS\.FREE : tier/);
  assert.match(source, /data-current=\{t === comparisonTier\}/);
  assert.match(source, /reviewedCell: "기존 혜택 3개"/);
  assert.match(source, /t === TIERS\.FREE && tier === TIERS\.REVIEWED && row\.reviewedCell/);
  assert.match(source, /기존 혜택[\s\S]{0,100}저장 장소 3곳[\s\S]{0,100}계속 유지/);
  assert.doesNotMatch(source, /COMPARE_COLS[^\n]*TIERS\.REVIEWED/);
});

test("결제 주기 radiogroup은 선택 항목만 Tab으로 진입하고 화살표 키로 선택과 초점을 함께 옮긴다", () => {
  assert.match(source, /subscriptionPlanForNavigationKey/);
  assert.match(source, /tabIndex=\{plan === "year" \? 0 : -1\}/);
  assert.match(source, /tabIndex=\{plan === "month" \? 0 : -1\}/);
  assert.match(source, /onKeyDown=\{\(event\) => onPlanKeyDown\(event, "year"\)\}/);
  assert.match(source, /onKeyDown=\{\(event\) => onPlanKeyDown\(event, "month"\)\}/);
  assert.match(source, /planRefs\.current\[nextPlan\]\?\.focus\(\)/);
});

test("7일 무료 체험은 Google Play가 eligible offer를 준 경우에만 조건과 자동 갱신을 안내한다", () => {
  assert.match(source, /selectedOffer\?\.hasSevenDayTrial/);
  assert.match(source, /결제 정보 등록 후 7일 동안 무료/);
  assert.match(source, /종료 후 Google Play에 표시된 구독 금액으로 자동 갱신/);
  assert.match(source, /Google Play에서 체험 종료 전에 취소/);
});

test("웹 자동결제는 국내 발급 카드 제한과 자동 갱신·해지 조건을 결제 주기 아래에서 안내한다", () => {
  assert.match(source, /!premiumActive && isWebBillingChannel/);
  assert.match(source, /웹 자동결제는 국내 발급 카드만 지원해요/);
  assert.match(source, /선택한 주기마다 자동 갱신되며 이 화면에서 언제든 해지 예약할 수 있어요/);
});

test("연간 구독은 확정 출시가의 월 환산 3,250원을 함께 보여준다", () => {
  assert.match(source, /월 환산 3,250원/);
});

test("무료 위치 안내는 약 10분 최근 위치와 오늘 경로를 숨긴다고 잘못 말하지 않는다", () => {
  assert.doesNotMatch(locationSource, /무료 플랜에서는 아이 위치를 볼 수 없어요/);
  assert.match(locationSource, /parent\.parentLocation\.copy029/);
  assert.match(locationSource, /parent\.parentLocation\.copy030/);
  assert.match(koParent["parent.parentLocation.copy029"], /무료 플랜은 약 10분 간격으로 최근 위치와 오늘 경로/);
  assert.match(koParent["parent.parentLocation.copy030"], /프리미엄은 지금 위치와 최근 30일 이동 기록/);
  assert.doesNotMatch(trialLockSource, /실시간 위치·이동 경로·AI 상세 기능/);
  assert.match(trialLockSource, /실시간 위치·30일 이동 기록·AI 상세 기능/);
});
