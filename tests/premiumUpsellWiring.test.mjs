import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("장소 추가 주 진입점과 3번째 저장은 상황형 업셀을 열고 작성값·복귀 경로를 보존한다", () => {
  const manager = read("src/screens/feature/PlaceManager.tsx");
  const source = read("src/screens/feature/PlaceForm.tsx");
  const managerGateStart = manager.indexOf("if (count >= limit)");
  const managerNavigateStart = manager.indexOf('navigate("/place-form")', managerGateStart);
  const limitStart = source.indexOf("if (places.length >= limit)");
  const mutationStart = source.indexOf("createPlace.mutate", limitStart);
  assert.ok(managerGateStart >= 0 && managerNavigateStart > managerGateStart);
  assert.ok(limitStart >= 0 && mutationStart > limitStart);
  const gate = source.slice(limitStart, mutationStart);

  assert.match(manager.slice(managerGateStart, managerNavigateStart), /setUpsellOpen\(true\)[\s\S]*return/);
  assert.match(manager, /source="saved_place"/);
  assert.match(manager, /usage=\{\{ used: places\.length, limit: placeLimitFor\(tier\) \}\}/);
  assert.match(manager, /returnTo="\/place-form"/);
  assert.match(manager, /savePremiumReturnIntent/);
  assert.match(source, /PremiumUpsell/);
  assert.match(source, /source="saved_place"/);
  assert.match(source, /const limit = placeLimitFor\(tier\)/);
  assert.match(source, /usage=\{\{ used: places\.length, limit \}\}/);
  assert.match(gate, /setUpsellOpen\(true\)/);
  assert.match(gate, /return/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /placeName/);
  assert.match(source, /address/);
  assert.match(source, /alertRadius/);
  assert.match(source, /picked/);
});

test("위험구역 2번째 등록은 기존 알림을 유지한 상황형 업셀을 열고 작성값을 보존한다", () => {
  const source = read("src/screens/feature/DangerZoneForm.tsx");
  assert.match(source, /dangerZoneLimitFor\(tier\)/);
  assert.match(source, /setUpsellOpen\(true\)/);
  assert.match(source, /source="danger_zone"/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /draft:\s*\{[^}]*name[^}]*address[^}]*radius[^}]*picked/s);
});

test("무료 소리 울리기 1회 소진은 발사 확인창 대신 상황형 업셀을 연다", () => {
  const source = read("src/screens/feature/RemoteRing.tsx");
  const quotaGate = source.indexOf("if (!quotaAllowed)");
  const confirmOpen = source.indexOf("setShowConfirm(true)", quotaGate);
  const ctaStart = source.indexOf('className="rr-cta hy-press"');
  const ctaEnd = source.indexOf("</button>", ctaStart);
  assert.ok(quotaGate >= 0 && confirmOpen > quotaGate);
  assert.ok(ctaStart >= 0 && ctaEnd > ctaStart);
  assert.match(source.slice(quotaGate, confirmOpen), /setUpsellOpen\(true\)[\s\S]*return/);
  assert.match(
    source.slice(ctaStart, ctaEnd),
    /disabled=\{!ringDataReady \|\| !targetChild\?\.user_id \|\| ringing \|\| trigger\.isPending\}/,
  );
  assert.doesNotMatch(source.slice(ctaStart, ctaEnd), /!quotaAllowed/);
  assert.match(source, /source="remote_ring"/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /draft:\s*\{[^}]*childUserId[^}]*durationSec/s);
});

test("소리 울리기는 결제를 취소하고 뒤로 와도 세션 intent에서 아이와 시간을 복원한다", () => {
  const source = read("src/screens/feature/RemoteRing.tsx");
  assert.match(source, /loadPremiumReturnIntent/);
  assert.match(source, /function restoredRemoteRingDraft/);
  assert.match(source, /intent\.source !== "remote_ring"/);
  assert.match(source, /intent\.returnTo !== "\/remote-ring"/);
  assert.match(source, /restoredRemoteRingDraft\(routeState\?\.premiumReturnDraft\)/);
  assert.match(source, /initialDraft\?\.childUserId/);
  assert.match(source, /initialDraft\?\.durationSec/);
});

test("소리 울리기는 앱 계정 user_id가 연결된 아이만 대상으로 허용한다", () => {
  const source = read("src/screens/feature/RemoteRing.tsx");
  assert.match(source, /m\.role === "child"[\s\S]{0,120}typeof m\.user_id === "string"[\s\S]{0,120}m\.user_id\.trim\(\)/);
  assert.match(source, /if \(!targetChild\?\.user_id\)/);
  assert.match(source, /disabled=\{!ringDataReady \|\| !targetChild\?\.user_id \|\| ringing \|\| trigger\.isPending\}/);
});

test("소리 울리기 rolling quota 안내는 모두 최근 24시간 기준으로 표시한다", () => {
  const source = read("src/screens/feature/RemoteRing.tsx");
  assert.match(source, /최근 24시간 소리 울리기 10회를 모두 사용했어요/);
  assert.match(source, /`최근 24시간 \$\{quota\.used\}\/\$\{quota\.quota\}회 사용`/);
  assert.match(source, /"최근 24시간 사용 횟수를 다 썼어요"/);
  assert.doesNotMatch(source, /오늘 소리 울리기/);
  assert.doesNotMatch(source, /`오늘 \$\{quota\.used\}/);
  assert.doesNotMatch(source, /오늘 사용 횟수/);
});

test("무료 주변소리는 감사 세션·기기 명령 전에 상황형 업셀로 닫는다", () => {
  const source = read("src/screens/feature/RemoteAudio.tsx");
  const start = source.indexOf("const startListen = async");
  const entitlementGate = source.indexOf("if (!remoteAudioAllowed)", start);
  const player = source.indexOf("new RemoteAudioPlayer", start);
  const killSwitch = source.indexOf("await isRemoteListenAllowed", start);
  const audit = source.indexOf("await openRemoteListenSession", start);
  const command = source.indexOf("requestListen.mutateAsync", start);

  assert.ok(start >= 0 && entitlementGate > start);
  assert.ok(entitlementGate < player && player < killSwitch && killSwitch < audit && audit < command);
  assert.match(source.slice(entitlementGate, player), /setUpsellOpen\(true\)/);
  assert.match(source.slice(entitlementGate, player), /return/);
  assert.match(source, /source="remote_audio"/);
  assert.match(source, /savePremiumReturnIntent/);
});

test("무료 주간 리포트는 실제 한 줄 요약 뒤 전체 리포트 업셀을 연다", () => {
  const source = read("src/screens/feature/WeeklyFamilyReport.tsx");
  assert.match(source, /weeklyReportTeaser\(summary/);
  assert.match(source, /setUpsellOpen\(true\)/);
  assert.match(source, /source="weekly_report"/);
  assert.match(source, /savePremiumReturnIntent/);
  assert.match(source, /무료 한 줄 요약/);
  assert.match(source, /이번 주 일정/);
  assert.match(source, /준비물 체크/);
  assert.match(source, /대화 메시지/);
  assert.match(source, /안전 알림/);
  assert.doesNotMatch(source, /자주 머문 장소/);
  assert.doesNotMatch(source, /프리미엄에서 기록이 쌓이면 보여드려요/);
  assert.match(source, /resolveWeeklyReportReturnChildId/);
  assert.match(source, /setActiveChildId\(restoredChildId\)/);
});

test("무료 AI 하루 요약은 조회·생성 전에 업셀로 닫는다", () => {
  const source = read("src/screens/feature/DaySummary.tsx");
  const generateGate = source.indexOf("if (!allowed)");
  const mutation = source.indexOf("generate.mutate", generateGate);
  assert.match(source, /useDaySummary\(allowed \? childUserId : null/);
  assert.ok(generateGate >= 0 && mutation > generateGate);
  assert.match(source.slice(generateGate, mutation), /setUpsellOpen\(true\)/);
  assert.match(source, /source="ai_daily_summary"/);
  assert.match(source, /savePremiumReturnIntent/);
});

test("무료 AI 일정 5회 소진은 원시 429를 노출하지 않고 상황형 업셀과 복귀 경로를 연다", () => {
  const source = read("src/screens/feature/AiSchedule.tsx");
  const normalized = source.replace(/\s+/g, " ");
  const quotaGate = normalized.indexOf('e instanceof ApiError && e.status === 429 && e.code === "daily_limit_reached"');
  const genericToast = normalized.indexOf('show(localizeApiError(e, intl, "formal"), "⚠️")', quotaGate);
  assert.ok(quotaGate >= 0 && genericToast > quotaGate, "429 업셀 분기는 일반 오류 표시보다 먼저여야 합니다");
  assert.match(normalized.slice(quotaGate, genericToast), /setScheduleLimitUpsellOpen\(true\);.*return;/);
  assert.doesNotMatch(source, /e\.message === "daily_limit_reached"|show\([^\n]*e\.message/);
  assert.match(source, /source="ai_schedule_limit"/);
  assert.match(source, /returnTo=\{`\/ai-schedule\?tab=\$\{tab\}`\}/);
  assert.match(source, /savePremiumReturnIntent/);
});

test("부모 홈은 초기 과거 알림을 건너뛰고 같은 세션의 신규 첫 도착 뒤 1회 가치 제안을 연다", () => {
  const source = read("src/screens/parent/ParentHome.tsx");
  assert.match(source, /findNewSuccessfulArrival/);
  assert.match(source, /alertsBaselineRef/);
  assert.match(source, /browserPremiumValueMomentStorage/);
  assert.match(source, /source=\{valueUpsellSource\}/);
  assert.match(source, /savePremiumReturnIntent/);
});
