// 아이 화면의 "부모님께 부탁하기" 회귀(2026-08-17 TK 지시).
//
// 아이가 대화를 다 쓰면 안내만 하고 끝나던 것을, 그 자리에서 부모에게 부탁하고
// 부모는 알림 한 번으로 충전 화면에 도달하게 만들었다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"] as const;
const IDS = [
  "child.aiChat.creditRequest.action",
  "child.aiChat.creditRequest.done",
  "child.aiChat.creditRequest.sent",
  "child.aiChat.creditRequest.already",
  "child.aiChat.creditRequest.failed",
] as const;

test("부탁 버튼은 한도 소진일 때만 붙는다(연결 실패에는 붙지 않는다)", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /isApiError\(err\) && err\.code === "daily_limit_reached"/);
  assert.match(chat, /creditExhausted: limitReached/);
  assert.match(chat, /m\.creditExhausted && \(/);
});

test("부탁 버튼은 진행 중 표시와 중복 전송 방지를 갖춘다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  // 약 1초 이상 걸리는 작업 — aria-busy 로 전역 진행 표시자를 켠다.
  assert.match(chat, /aria-busy=\{creditRequest === "sending"\}/);
  assert.match(chat, /disabled=\{creditRequest !== "idle"\}/);
  assert.match(chat, /if \(creditRequest !== "idle" \|\| !familyId \|\| !userId\) return;/);
});

test("아이는 요청만 보내고 부모 알림 문구는 서버가 만든다", () => {
  const endpoints = read("src/lib/api/endpoints/family.ts");
  const start = endpoints.indexOf("export async function sendAiCreditRequest");
  assert.ok(start >= 0, "sendAiCreditRequest 가 없다");
  const block = endpoints.slice(start, start + 900);
  assert.match(block, /alert_type: "ai_credit_request"/);
  // 아이 입력을 부모 알림 본문으로 싣지 않는다.
  assert.match(block, /title: ""/);
  assert.match(block, /message: ""/);
});

test("부모 알림을 탭하면 충전·한도 화면으로 간다", () => {
  const view = read("src/transform/notificationsView.ts");
  assert.match(view, /normalized === "ai_credit_request"\) return "\/ai-credit"/);
});

test("부탁 문구는 10개 locale 에 모두 있고 아이 말투를 지킨다", () => {
  for (const locale of LOCALES) {
    const catalog = JSON.parse(read(`locales/${locale}/child.json`)) as Record<string, string>;
    for (const id of IDS) {
      assert.ok((catalog[id] ?? "").trim().length > 0, `${locale}:${id} 누락`);
    }
  }
  const ko = JSON.parse(read("locales/ko/child.json")) as Record<string, string>;
  // 아이 화면이라 존댓말을 쓰지 않는다.
  for (const id of IDS) {
    assert.doesNotMatch(ko[id], /습니다|하세요|해요\.?$/, `${id} 가 존댓말이다`);
  }
});
