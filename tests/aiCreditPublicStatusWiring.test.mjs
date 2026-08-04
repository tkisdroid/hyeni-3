import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const endpoint = read("src/lib/api/endpoints/ai.ts");
const queries = read("src/queries/useAi.ts");
const keys = read("src/queries/keys.ts");
const childHome = read("src/screens/child/ChildHome.tsx");
const childChat = read("src/screens/child/AiFriendChat.tsx");
const parentCredit = read("src/screens/feature/AiCredit.tsx");

test("AI 공개 사용량 API는 unknown 응답을 엄격히 정규화한 뒤에만 반환한다", () => {
  assert.match(endpoint, /\/api\/ai\/credits\/public-status/);
  assert.match(endpoint, /apiGet<unknown>/);
  assert.match(endpoint, /normalizeAiCreditPublicStatusPayload/);
  assert.match(endpoint, /invalid_ai_credit_public_status/);
});

test("AI 공개 사용량 쿼리는 가족·아이별 캐시를 분리한다", () => {
  assert.match(keys, /aiCreditPublicStatus:\s*\(familyId: string, childUserId: string\)/);
  assert.match(queries, /export function useAiCreditPublicStatus/);
  assert.match(queries, /qk\.aiCreditPublicStatus\(familyId \?\? "", childUserId \?\? ""\)/);
});

test("아이 홈과 채팅은 부모 설정값을 재계산하지 않고 서버의 실제 availableRemaining만 표시한다", () => {
  for (const source of [childHome, childChat]) {
    assert.match(source, /useAiCreditPublicStatus/);
    assert.match(source, /availableRemaining/);
    assert.doesNotMatch(source, /useAiUsageToday/);
    assert.doesNotMatch(source, /remainingAiChats/);
  }
});

test("채팅 성공 응답은 화면 잔여 횟수와 공개 사용량 캐시를 같은 서버 값으로 맞춘다", () => {
  assert.match(childChat, /setRemaining\(res\.remaining\)/);
  assert.match(queries, /setQueryData<AiCreditPublicStatus>/);
  assert.match(queries, /availableRemaining:\s*nextRemaining/);
  assert.match(queries, /invalidateQueries\(\{ queryKey: qk\.aiCredits/);
});

test("부모 크레딧 화면은 공개 서버 잔여량을 우선하고 명시된 티어에만 5회·20회 폴백한다", () => {
  assert.match(parentCredit, /useAiCreditPublicStatus/);
  assert.match(parentCredit, /publicStatus\?\.availableRemaining/);
  assert.match(parentCredit, /aiIncludedDailyLimitForExplicitTier/);
  assert.doesNotMatch(parentCredit, /friendSettings\?\.daily_limit \?\? 5/);
});
