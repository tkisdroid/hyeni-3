// 아이 하루 대시보드 — 프리미엄 보호자에게 하루 한 번(2026-08-19 TK 지시) 회귀.
//
// 이 테스트가 지키는 것
//  · 대시보드 payload 에 **아이 대화 원문이 들어가지 않는다**(주제·집계만).
//  · 아무 기록도 없는 날에는 알림을 보내지 않는다(빈 알림은 소음이다).
//  · 하루·아이당 한 번이라는 계약이 SQL(PK + INSERT OR IGNORE)로 강제된다.
//  · 무료 가족과 엔타이틀먼트 조회 실패는 프리미엄으로 추정하지 않는다(fail-closed).
import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildChildDailyDigest,
  buildChildDailyDigestAlert,
  childDailyDigestEventId,
  countChecklistItems,
  isChildDailyDigestWindow,
  shouldSendChildDailyDigest,
  summarizeAlertCounts,
  summarizeChatTopics,
  summarizeDiscoveries,
  CHILD_DAILY_DIGEST_ALERT_TYPE,
  MAX_DIGEST_TOPICS,
} from "../shared/childDailyDigest.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("대화는 주제만 남기고 원문은 payload 에 담지 않는다", () => {
  const secret = "오늘 학교에서 민수랑 싸워서 너무 속상했어";
  const digest = buildChildDailyDigest({
    dateKey: "2026-08-19",
    childName: "혜니",
    chatMessages: [{ role: "user", content: secret }],
  });
  const serialized = JSON.stringify(digest);
  assert.doesNotMatch(serialized, /민수/, "아이 대화 원문이 대시보드에 새어 나갔다");
  assert.doesNotMatch(serialized, /싸워서/, "아이 대화 원문이 대시보드에 새어 나갔다");
  assert.equal(digest.chat.count, 1);
  assert.ok(digest.chat.topics.some((topic) => topic.label === "학교생활"));
  assert.ok(digest.chat.topics.some((topic) => topic.label === "기분·감정"));
});

test("주제는 많이 나온 순서로 최대 3개만 남는다", () => {
  const topics = summarizeChatTopics([
    { role: "user", content: "학교 재밌었어" },
    { role: "user", content: "학교 급식 맛있었어" },
    { role: "user", content: "친구랑 놀았어" },
    { role: "user", content: "게임 하고 싶어" },
    { role: "user", content: "엄마 보고 싶어" },
  ]);
  assert.ok(topics.length <= MAX_DIGEST_TOPICS);
  assert.equal(topics[0].label, "학교생활");
  assert.ok(topics[0].count >= 2);
});

test("부모 비공개 기억은 대시보드에 넣지 않는다", () => {
  const lines = summarizeDiscoveries([
    { value: "레고를 좋아함", parent_visible: 1 },
    { value: "비밀로 저장된 것", parent_visible: 0 },
    { value: "레고를 좋아함", parent_visible: 1 },
  ]);
  assert.deepEqual(lines, ["레고를 좋아함"]);
});

test("안전 신호는 심각도 개수만 남기고 무슨 말이었는지는 담지 않는다", () => {
  const digest = buildChildDailyDigest({
    safetyEvents: [{ severity: "high", summary: "자세한 내용" }, { severity: "low" }],
  });
  assert.equal(digest.chat.safetySignals, 1);
  assert.doesNotMatch(JSON.stringify(digest), /자세한 내용/);
});

test("이동 알림은 종류별 횟수로만 요약한다", () => {
  const counts = summarizeAlertCounts([
    { alert_type: "place_arrived" },
    { alert_type: "arrived" },
    { alert_type: "place_left" },
    { alert_type: "danger_zone" },
    { alert_type: "not_arrived" },
    { alert_type: "new_memo" },
  ]);
  assert.deepEqual(counts, { arrived: 2, left: 1, danger: 1, notArrived: 1, other: 1 });
});

test("준비물·숙제는 항목 수만 센다", () => {
  assert.equal(countChecklistItems("도복, 띠\n물통"), 3);
  assert.equal(countChecklistItems(""), 0);
  assert.equal(countChecklistItems(null), 0);
});

test("아무 기록도 없는 날에는 알림을 보내지 않는다", () => {
  const empty = buildChildDailyDigest({ dateKey: "2026-08-19", childName: "혜니" });
  assert.equal(shouldSendChildDailyDigest(empty), false);
  assert.equal(shouldSendChildDailyDigest(null), false);

  // 대화만 있어도 보낼 가치가 있다.
  assert.equal(
    shouldSendChildDailyDigest(buildChildDailyDigest({ chatMessages: [{ role: "user", content: "안녕" }] })),
    true,
  );
  // 일정만 있어도 보낸다.
  assert.equal(
    shouldSendChildDailyDigest(buildChildDailyDigest({ events: [{ title: "태권도" }] })),
    true,
  );
  // 이동 기록만 있어도 보낸다.
  assert.equal(
    shouldSendChildDailyDigest(buildChildDailyDigest({ alerts: [{ alert_type: "place_arrived" }] })),
    true,
  );
});

test("알림 문구는 실제 집계값만 말하고 0을 자랑하지 않는다", () => {
  const digest = buildChildDailyDigest({
    childName: "혜니",
    chatMessages: [{ role: "user", content: "학교 재밌었어" }],
    events: [{ title: "태권도", time: "17:00" }],
    alerts: [{ alert_type: "place_arrived" }, { alert_type: "place_left" }],
  });
  const alert = buildChildDailyDigestAlert(digest);
  assert.match(alert.title, /혜니는 오늘 이렇게 지냈어요/);
  assert.match(alert.message, /1번 이야기했어요/);
  assert.match(alert.message, /일정 1개/);
  assert.match(alert.message, /이동 기록 2건/);

  // 기록이 없는 항목은 문장에 넣지 않는다.
  const quiet = buildChildDailyDigestAlert(buildChildDailyDigest({ childName: "수호" }));
  assert.match(quiet.title, /수호는/);
  assert.doesNotMatch(quiet.message, /0번|0개|0건/);
});

test("받침에 따라 조사가 바뀐다", () => {
  assert.match(buildChildDailyDigestAlert({ childName: "혜니" }).title, /혜니는/);
  assert.match(buildChildDailyDigestAlert({ childName: "수호" }).title, /수호는/);
  assert.match(buildChildDailyDigestAlert({ childName: "지원" }).title, /지원은/);
});

test("저녁 창에서만 만들고 멱등 키는 아이·날짜로 갈린다", () => {
  assert.equal(isChildDailyDigestWindow("20:00"), true);
  assert.equal(isChildDailyDigestWindow("22:50"), true);
  assert.equal(isChildDailyDigestWindow("19:59"), false);
  assert.equal(isChildDailyDigestWindow("23:00"), false);
  assert.equal(isChildDailyDigestWindow("아침"), false);

  assert.notEqual(
    childDailyDigestEventId("child-a", "2026-08-19"),
    childDailyDigestEventId("child-b", "2026-08-19"),
  );
  assert.notEqual(
    childDailyDigestEventId("child-a", "2026-08-19"),
    childDailyDigestEventId("child-a", "2026-08-20"),
  );
});

// ── 배선 가드 ──────────────────────────────────────────────────────────────

test("하루 한 번은 DB PK 와 INSERT OR IGNORE 로 보증한다", () => {
  const migration = read("worker/db/child-daily-digest.sql");
  assert.match(migration, /PRIMARY KEY \("family_id", "child_user_id", "date_key"\)/);
  assert.match(read("cloudflare/schema_d1.sql"), /CREATE TABLE IF NOT EXISTS "child_daily_digests"/);

  const cron = read("worker/cron/child-daily-digest.ts");
  assert.match(cron, /INSERT OR IGNORE INTO child_daily_digests/);
  // 행을 실제로 만든 실행만 알림을 보낸다.
  assert.match(cron, /if \(Number\(insert\.meta\?\.changes \?\? 0\) === 0\) continue;/);
  // 이미 만든 아이는 후보 조회에서 걸러 낸다.
  assert.match(cron, /NOT EXISTS \(\s*SELECT 1 FROM child_daily_digests/);
});

test("무료 가족과 엔타이틀먼트 실패는 프리미엄으로 추정하지 않는다", () => {
  const cron = read("worker/cron/child-daily-digest.ts");
  assert.match(cron, /catch \{[\s\S]{0,140}isPremium = false;/);
  assert.match(cron, /if \(!isPremium\) \{\s*premiumSkipped \+= 1;\s*continue;/);
});

test("대시보드 알림은 알림함이 아니라 그 아이의 대시보드 화면을 연다", () => {
  const policy = read("worker/lib/parentAlertPushPolicy.ts");
  assert.match(policy, /"child_daily_digest",/);
  assert.match(policy, /alertType === "child_daily_digest"[\s\S]{0,120}route: "\/child-digest"/);
  const route = read("worker/lib/parentAlertRoute.ts");
  assert.match(route, /baseRoute === "\/child-digest"/);
  assert.equal(CHILD_DAILY_DIGEST_ALERT_TYPE, "child_daily_digest");
});

test("조회 API 는 프리미엄 보호자만 열고 대화 원문 컬럼을 읽지 않는다", () => {
  const ai = read("worker/routes/ai.ts");
  const start = ai.indexOf('ai.get("/daily-digest"');
  assert.ok(start > 0, "daily-digest 조회 route 누락");
  const block = ai.slice(start, start + 2400);
  assert.match(block, /authorizePremiumAiParent\(db, \{ callerUserId, familyId \}/);
  assert.match(block, /SELECT date_key, payload, notified_at FROM child_daily_digests/);
  assert.doesNotMatch(block, /ai_chat_messages/);
});

test("cron 은 새 트리거를 만들지 않고 기존 10분 트리거에 얹는다", () => {
  const index = read("worker/index.ts");
  assert.match(index, /\{ name: "child-daily-digest", run: runChildDailyDigest \}/);
  // Cloudflare Free 플랜 cron trigger 5개 한도 — 표현식이 늘어나면 배포가 막힌다.
  const expressions = [...index.matchAll(/^\s{2}"([^"]*\*[^"]*)": \[/gm)].map((match) => match[1]);
  assert.ok(expressions.length <= 4, `cron 표현식이 ${expressions.length}개로 늘었다`);
});
