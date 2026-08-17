// 아이 AI 대화 실패 안내 회귀(2026-08-17 TK 제보).
//
// 실사고: 채팅을 보내면 말풍선에 "잠깐 연결이 안됐어"가 뜨고 동시에 하단에
// "방금 한 일이 저장되지 않았어" 토스트가 겹쳐 떴다. 원인은 두 가지였다.
//  ① useSendChildChat 에 mutation 단위 onError 가 없어 전역 MutationCache 폴백이 함께 발사됐다.
//     (콜사이트 mutate(vars,{onError}) 는 mutation.options.onError 가 아니라 폴백을 막지 못한다.)
//  ② 실제 원인은 OpenAI 크레딧 소진(429)인데 "연결" 문제로 잘못 안내했다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("아이 대화 전송 실패는 말풍선 하나로만 알린다(전역 토스트 중복 금지)", () => {
  const useAi = read("src/queries/useAi.ts");
  // useSendChildChat 블록 안에 silentError 가 있어야 폴백 토스트가 겹치지 않는다.
  const start = useAi.indexOf("export function useSendChildChat()");
  assert.ok(start >= 0, "useSendChildChat 이 없다");
  const end = useAi.indexOf("export function", start + 10);
  const block = useAi.slice(start, end > start ? end : undefined);
  assert.match(block, /meta: \{ silentError: true \}/);
});

test("전역 폴백 토스트는 mutation 단위 onError·silentError 를 모두 존중한다", () => {
  const provider = read("src/queries/QueryProvider.tsx");
  assert.match(provider, /if \(mutation\.options\.onError\) return;/);
  assert.match(provider, /if \(mutation\.options\.meta\?\.silentError === true\) return;/);
});

test("공급자 한도·잔액(429)은 연결 실패와 다른 코드로 내려온다", () => {
  const route = read("worker/routes/ai-child-chat.ts");
  assert.match(route, /openaiRes\.status === 429\s*\r?\n?\s*\? c\.json\(\{ error: "ai_provider_busy" \}, 503\)/);
  assert.match(route, /: c\.json\(\{ error: "ai_failure" \}, 502\)/);
});

test("아이에게는 연결 탓 대신 지금 대답할 수 없다고 정직하게 말한다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.match(chat, /case "ai_provider_busy":/);
  assert.match(chat, /id: "child\.aiChat\.providerBusy"/);

  const ko = JSON.parse(read("locales/ko/child.json")) as Record<string, string>;
  const busy = ko["child.aiChat.providerBusy"] ?? "";
  assert.ok(busy.length > 0, "providerBusy 한국어 문구가 없다");
  // 원인이 네트워크가 아니므로 "연결"이라고 말하지 않는다.
  assert.doesNotMatch(busy, /연결/);
  // 10개 locale 모두 채워져 있어야 한다.
  for (const locale of ["en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"]) {
    const catalog = JSON.parse(read(`locales/${locale}/child.json`)) as Record<string, string>;
    assert.ok((catalog["child.aiChat.providerBusy"] ?? "").trim().length > 0, `${locale} providerBusy 누락`);
  }
});

test("공급자 오류 코드는 로그로 남기되 사용자 원문은 담지 않는다", () => {
  const log = read("worker/lib/openaiLog.ts");
  assert.match(log, /providerErrorCode/);
  // 짧은 enum 형태만 통과시켜 오류 본문이 로그로 새지 않게 한다.
  assert.match(log, /code\.length > 48/);
  assert.match(log, /\^\[a-z0-9_\.-\]\+\$/i);
});
