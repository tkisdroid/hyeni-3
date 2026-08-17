// 아이 → 부모 AI 대화 충전 요청 회귀(2026-08-17 TK 지시).
//
// 계약:
//  · 아이가 오늘 대화를 다 썼을 때만 부모에게 요청이 간다(남아 있으면 거절).
//  · 부모가 읽는 제목·본문은 서버가 만든다(아이 입력을 부모 알림으로 밀어 넣지 못한다).
//  · 부모가 정한 하루 상한이 원인이면 크레딧 구매를 권하지 않는다(사도 안 풀린다).
//  · 부모 알림을 탭하면 알림함이 아니라 충전·한도 화면으로 직행한다.
import "./helpers/tsModuleResolve.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const {
  AI_CREDIT_REQUEST_COOLDOWN_MS,
  buildAiCreditRequestAlert,
  isAiCreditRequestWithinCooldown,
  resolveAiCreditRequestReason,
} = await import("../shared/aiCreditRequestAlert.js");
const { resolveParentAlertPushType } = await import("../lib/parentAlertPushPolicy.ts");
const { parsePgTimestampMs } = await import("../lib/aiCreditRequestGate.ts");
const { parentAlertTargetRoute } = await import("../lib/parentAlertRoute.ts");

test("부모 상한이 포함량보다 낮으면 크레딧이 아니라 상한이 원인이다", () => {
  assert.equal(
    resolveAiCreditRequestReason({ isPremium: false, dailyIncludedLimit: 5, parentDailyLimit: 3 }),
    "parent_safety_limit",
  );
  assert.equal(
    resolveAiCreditRequestReason({ isPremium: true, dailyIncludedLimit: 20, parentDailyLimit: 10 }),
    "parent_safety_limit",
  );
  // 상한이 포함량 이상이면 포함량이 먼저 걸린 것이다.
  assert.equal(
    resolveAiCreditRequestReason({ isPremium: false, dailyIncludedLimit: 5, parentDailyLimit: 5 }),
    "free_included_limit",
  );
  assert.equal(
    resolveAiCreditRequestReason({ isPremium: true, dailyIncludedLimit: 20, parentDailyLimit: 20 }),
    "premium_allowance_limit",
  );
});

test("부모 상한이 원인이면 구매를 권하지 않는다(사도 안 풀리므로)", () => {
  const alert = buildAiCreditRequestAlert({
    familyId: "f1",
    childUserId: "c1",
    childName: "혜니",
    reason: "parent_safety_limit",
  });
  assert.equal(alert.alert_type, "ai_credit_request");
  assert.equal(alert.severity, "info");
  assert.match(alert.message, /혜니/);
  assert.match(alert.message, /횟수를 늘려/);
  assert.doesNotMatch(alert.message, /충전|프리미엄/);
});

test("포함량 소진이 원인이면 충전 경로를 안내한다", () => {
  const free = buildAiCreditRequestAlert({
    familyId: "f1", childUserId: "c1", childName: "혜니", reason: "free_included_limit",
  });
  assert.match(free.message, /충전|프리미엄/);
  const premium = buildAiCreditRequestAlert({
    familyId: "f1", childUserId: "c1", childName: "혜니", reason: "premium_allowance_limit",
  });
  assert.match(premium.message, /충전/);
});

test("아이 이름이 없어도 부모가 읽을 수 있는 문구를 만든다", () => {
  const alert = buildAiCreditRequestAlert({ familyId: "f1", childUserId: "c1" });
  assert.match(alert.message, /^아이님/);
  assert.equal(alert.metadata.child_user_id, "c1");
  // 식별자가 없으면 알림 자체를 만들지 않는다.
  assert.equal(buildAiCreditRequestAlert({ familyId: "", childUserId: "c1" }), null);
  assert.equal(buildAiCreditRequestAlert({ familyId: "f1", childUserId: "" }), null);
});

test("최근 요청 쿨다운은 3시간이고 잘못된 값에 걸리지 않는다", () => {
  const now = Date.parse("2026-08-17T12:00:00.000Z");
  assert.equal(AI_CREDIT_REQUEST_COOLDOWN_MS, 3 * 60 * 60 * 1000);
  assert.equal(isAiCreditRequestWithinCooldown(now - 60_000, now), true);
  assert.equal(isAiCreditRequestWithinCooldown(now - 4 * 60 * 60 * 1000, now), false);
  // Number(null)===0 함정 — null/NaN 을 0(1970년)으로 읽어 "쿨다운 아님"으로 오판하지 않는다.
  for (const bad of [null, undefined, NaN, "abc"]) {
    assert.equal(isAiCreditRequestWithinCooldown(bad, now), false);
  }
});

test("D1 timestamp 의 +00 을 Z 로 정규화해야 쿨다운이 걸린다", () => {
  // 실사고: `+00` 은 유효한 ISO offset 이 아니라 Date.parse 가 NaN → "최근 요청 없음"으로
  // 오판해 부모에게 알림이 매번 새로 갔다(라이브에서 2건 연속 생성됨).
  const raw = "2026-08-17 05:12:33.123456+00";
  const parsed = parsePgTimestampMs(raw);
  assert.equal(parsed, Date.parse("2026-08-17T05:12:33.123456Z"));
  assert.equal(isAiCreditRequestWithinCooldown(parsed, parsed + 60_000), true);
  // 정규화를 빠뜨린 형태는 실제로 NaN 이 된다(회귀가 무의미해지지 않도록 확인).
  assert.equal(Number.isNaN(Date.parse(raw.replace(" ", "T"))), true);
  for (const bad of [null, undefined, "", "   ", 123]) {
    assert.equal(parsePgTimestampMs(bad), null);
  }
});

test("부모 알림은 푸시로 나가고 알림함이 아니라 충전 화면으로 보낸다", () => {
  const policy = resolveParentAlertPushType("ai_credit_request", "info");
  assert.ok(policy, "푸시 정책이 없으면 앱을 닫아 둔 부모에게 닿지 않는다");
  assert.equal(policy.route, "/ai-credit");
  assert.equal(policy.type, "parent_alert");
  assert.equal(policy.urgent, false);
  // severity 를 올려도 긴급 알림으로 승격되지 않는다(안전 알림 톤 잠식 방지).
  assert.equal(resolveParentAlertPushType("ai_credit_request", "emergency").urgent, false);
});

test("충전 화면 딥링크는 대상 아이를 함께 싣는다(다자녀 오귀속 방지)", () => {
  assert.equal(
    parentAlertTargetRoute("/ai-credit", "alert-1", "child-1"),
    "/ai-credit?alert=alert-1&child=child-1",
  );
  // 알림함은 아이를 특정할 필요가 없다 — 기존 계약 그대로.
  assert.equal(parentAlertTargetRoute("/notifications", "alert-1", "child-1"), "/notifications?alert=alert-1");
});

test("아이가 쓸 수 있는 알림 유형에 포함되고 본문은 서버가 덮어쓴다", async () => {
  const [authorization, route] = await Promise.all([
    readFile(resolve(workerDir, "lib/parentAlertAuthorization.ts"), "utf8"),
    readFile(resolve(workerDir, "routes/parent-alerts.ts"), "utf8"),
  ]);
  assert.match(authorization, /"ai_credit_request",/);
  // 서버 판정 결과로 title/message 를 교체해야 아이가 임의 문구를 부모에게 푸시하지 못한다.
  assert.match(route, /alertType === "ai_credit_request"/);
  assert.match(route, /title = evidence\.evidence\.title/);
  assert.match(route, /message = evidence\.evidence\.message/);
  // 아직 대화가 남아 있으면 요청 자체를 닫는다.
  const gate = await readFile(resolve(workerDir, "lib/aiCreditRequestGate.ts"), "utf8");
  assert.match(gate, /status\?\.canChat !== false/);
  assert.match(gate, /ai_credit_available/);
});

test("아이가 말을 건 turn 은 LLM 사용 여부와 무관하게 1회 차감한다", async () => {
  const { shouldChargeForAiTurn } = await import("../shared/aiUsagePolicy.js");
  // 서버가 LLM 없이 결정적으로 답하는 도구도 1회로 센다(과금 예측 가능성 우선).
  for (const toolName of [
    "updateNotificationSettings", "updateAiFriendName", "changeAppTheme",
    "getTodaySchedule", "getScheduleByDate", "createSchedule",
  ]) {
    assert.equal(
      shouldChargeForAiTurn({ detectedIntent: "schedule_lookup", toolResult: { ok: true, toolName } }),
      true,
      `${toolName} 이 차감되지 않는다`,
    );
  }
  assert.equal(shouldChargeForAiTurn({ detectedIntent: "general_chat", toolResult: null }), true);
});

test("안전 위험과 거절만 한 turn 은 차감하지 않는다", async () => {
  const { shouldChargeForAiTurn, shouldBypassAiCreditLimit } = await import("../shared/aiUsagePolicy.js");
  // ① 힘든 아이가 도움을 청한 turn — 한도가 0이어도 열리고 차감도 없다.
  for (const riskLevel of ["medium", "high"]) {
    assert.equal(shouldChargeForAiTurn({ detectedIntent: "general_chat", safety: { riskLevel } }), false);
    assert.equal(shouldBypassAiCreditLimit({ safety: { riskLevel } }), true);
  }
  // ② 해 준 것 없이 거절만 한 turn.
  for (const detectedIntent of [
    "parent_forbidden_topic", "parent_allowed_topic_restriction", "external_contact_rejected",
    "parent_tool_disabled", "schedule_delete_parent_only", "notification_settings_parent_only",
  ]) {
    assert.equal(shouldChargeForAiTurn({ detectedIntent }), false, `${detectedIntent} 이 차감된다`);
  }
  // 도구가 실패해 아이가 얻은 게 없는 turn.
  assert.equal(
    shouldChargeForAiTurn({ detectedIntent: "schedule_create", toolResult: { ok: false, toolName: "createSchedule" } }),
    false,
  );
});
