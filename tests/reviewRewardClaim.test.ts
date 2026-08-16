import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(rootDir, path), "utf8");

test("리뷰 혜택 클라이언트 엔드포인트는 기존 상태 GET만 유지한다", () => {
  const endpoint = read("src/lib/api/endpoints/reviewReward.ts");
  assert.match(endpoint, /apiGet<ReviewRewardResponse>/);
  assert.match(endpoint, /\/api\/review-rewards\?familyId=/);
  assert.doesNotMatch(endpoint, /apiPost|claimReviewReward|ReviewRewardClaimResponse/);
});

test("useReviewReward는 기존 family_review_rewards 조회만 수행한다", () => {
  const keys = read("src/queries/keys.ts");
  const hook = read("src/queries/useReviewReward.ts");
  assert.match(keys, /reviewReward:\s*\(familyId: string\) => \["reviewReward", familyId\] as const/);
  assert.match(hook, /queryKey:\s*qk\.reviewReward\(familyId \?\? ""\)/);
  assert.match(hook, /fetchReviewReward/);
  assert.doesNotMatch(hook, /useMutation|useQueryClient|claimReviewReward|useClaimReviewReward/);
});

test("부모 설정은 신규 지급 CTA를 제거하고 종료·기존 혜택 유지 문구를 구분한다", () => {
  const settings = read("src/screens/parent/ParentSettings.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json")) as Record<string, string>;
  assert.equal(
    koParent["parent.parentSettings.copy002"],
    "스토어 방문 혜택의 신규 지급은 종료되었어요",
  );
  assert.equal(
    koParent["parent.parentSettings.copy001"],
    "기존에 받은 스토어 방문 혜택은 그대로 유지돼요",
  );
  assert.match(settings, /parent\.parentSettings\.copy002/);
  assert.match(settings, /parent\.parentSettings\.copy001/);
  assert.doesNotMatch(settings, /스토어 방문 혜택 받기/);
  assert.doesNotMatch(settings, /useClaimReviewReward|runReviewRewardClaimFlow|openGooglePlayReviewListing/);
});

test("기존 reviewed 가족 안내는 신규 지급으로 오해되지 않게 유지 상태로 표현한다", () => {
  const trialLock = read("src/screens/feature/TrialLock.tsx");
  assert.match(trialLock, /기존 스토어 방문 혜택 유지 중 · 장소를 3개까지 저장할 수 있어요/);
  assert.doesNotMatch(trialLock, /혜택 유지 중 · 일정/);
  assert.doesNotMatch(trialLock, /스토어 방문 혜택 적용 중/);
});
