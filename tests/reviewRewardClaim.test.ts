import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(rootDir, path), "utf8");

test("리뷰 혜택 지급 요청은 familyId만 POST하고 200 실패 본문을 성공으로 취급하지 않는다", () => {
  const endpoint = read("src/lib/api/endpoints/reviewReward.ts");
  assert.match(endpoint, /apiPost<ReviewRewardClaimResponse>\(\s*"\/api\/review-rewards",\s*\{ familyId \},?\s*\)/s);
  assert.match(endpoint, /response\.ok !== true \|\| response\.rewarded !== true/);
  assert.doesNotMatch(endpoint, /reviewed|rating|stars|positive/i);
  assert.doesNotMatch(endpoint, /리뷰를 남긴|리뷰 작성 완료|긍정/);
});

test("리뷰 보상 query key와 지급 성공 cache 갱신은 qk를 단일 출처로 사용한다", () => {
  const keys = read("src/queries/keys.ts");
  const hook = read("src/queries/useReviewReward.ts");
  assert.match(keys, /reviewReward:\s*\(familyId: string\) => \["reviewReward", familyId\] as const/);
  assert.match(hook, /queryKey:\s*qk\.reviewReward\(familyId \?\? ""\)/);
  assert.match(hook, /useMutation/);
  assert.match(hook, /queryClient\.setQueryData\(qk\.reviewReward\(familyId\), \{ rewarded: true \}\)/);
});

test("리뷰 지급 흐름은 성공 후에만 Play HTTPS listing을 열고 연속 탭을 한 번으로 합친다", async () => {
  const nativePath = resolve(rootDir, "src/lib/native/review.ts");
  assert.equal(existsSync(nativePath), true, "src/lib/native/review.ts가 필요합니다");
  const nativeSource = readFileSync(nativePath, "utf8");
  assert.match(nativeSource, /https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.hyeni\.calendar/);

  const { runReviewRewardClaimFlow } = await import("../src/lib/native/review.ts");
  let resolveClaim: (() => void) | null = null;
  let claimCalls = 0;
  let cacheUpdates = 0;
  let storeCalls = 0;
  const ref: Parameters<typeof runReviewRewardClaimFlow>[0] = { current: null };

  const first = runReviewRewardClaimFlow(
    ref,
    () => {
      claimCalls += 1;
      return new Promise<void>((resolvePromise) => {
        resolveClaim = resolvePromise;
      });
    },
    () => {
      cacheUpdates += 1;
    },
    async () => {
      assert.equal(cacheUpdates, 1, "cache 성공 처리보다 스토어가 먼저 열리면 안 됩니다");
      storeCalls += 1;
    },
  );
  const second = runReviewRewardClaimFlow(ref, async () => undefined, () => undefined, async () => undefined);

  assert.strictEqual(second, first);
  assert.equal(claimCalls, 1);
  assert.equal(storeCalls, 0);
  assert.ok(resolveClaim);
  resolveClaim();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.storeOpened, true);
  assert.strictEqual(secondResult, firstResult);
  assert.equal(cacheUpdates, 1);
  assert.equal(storeCalls, 1);
  assert.equal(ref.current, null);
});

test("리뷰 지급 실패는 스토어를 열지 않고, 스토어 실패는 이미 적용된 혜택과 구분한다", async () => {
  const nativePath = resolve(rootDir, "src/lib/native/review.ts");
  assert.equal(existsSync(nativePath), true, "src/lib/native/review.ts가 필요합니다");
  const { runReviewRewardClaimFlow } = await import("../src/lib/native/review.ts");

  let storeCalls = 0;
  await assert.rejects(
    runReviewRewardClaimFlow(
      { current: null },
      async () => {
        throw new Error("지급 실패");
      },
      () => undefined,
      async () => {
        storeCalls += 1;
      },
    ),
    /지급 실패/,
  );
  assert.equal(storeCalls, 0);

  let rewardApplied = false;
  const storeFailure = await runReviewRewardClaimFlow(
    { current: null },
    async () => undefined,
    () => {
      rewardApplied = true;
    },
    async () => {
      throw new Error("스토어 실패");
    },
  );
  assert.equal(rewardApplied, true);
  assert.equal(storeFailure.storeOpened, false);
  assert.match(String(storeFailure.storeError), /스토어 실패/);
});

test("부모 설정 CTA는 스토어 방문 혜택만 안내하고 평가·리뷰·별점을 대가로 요구하지 않는다", () => {
  const settings = read("src/screens/parent/ParentSettings.tsx");
  assert.match(settings, /const showReviewRewardCta = ready && tier === TIERS\.FREE/);
  assert.match(settings, /useRef<Promise<ReviewRewardClaimFlowResult> \| null>\(null\)/);
  assert.match(settings, /runReviewRewardClaimFlow\(/);
  assert.match(settings, /reviewRewardClaim\.isPending/);
  assert.match(settings, /disabled=\{reviewRewardClaim\.isPending/);
  assert.match(settings, /스토어 방문 혜택 받기/);
  assert.match(settings, /혜택은 적용됐지만 Google Play를 열지 못했어요/);
  assert.doesNotMatch(settings, /앱 평가하고 혜택 받기/);
  assert.doesNotMatch(settings, /(?:평가|리뷰|별점).{0,20}혜택|혜택.{0,20}(?:평가|리뷰|별점)/);
});

test("혜택 적용 뒤 노출 문구도 리뷰 대가가 아니라 스토어 방문 혜택으로 통일한다", () => {
  const tierPolicy = read("src/transform/tierPolicy.ts");
  const aiSchedule = read("src/screens/feature/AiSchedule.tsx");
  const trialLock = read("src/screens/feature/TrialLock.tsx");
  const rewardHook = read("src/queries/useReviewReward.ts");
  const endpoint = read("src/lib/api/endpoints/reviewReward.ts");

  assert.match(tierPolicy, /return "스토어 방문 혜택"/);
  assert.match(aiSchedule, /스토어 방문 혜택을 받으면 3개/);
  assert.match(aiSchedule, /스토어 방문 혜택으로 일정 3개/);
  assert.match(trialLock, /스토어 방문 혜택 적용 중/);
  assert.match(rewardHook, /"스토어 방문 혜택을 받을 수 없는 상태예요"/);
  assert.match(endpoint, /"스토어 방문 혜택을 적용하지 못했어요"/);

  for (const source of [tierPolicy, aiSchedule, trialLock, rewardHook, endpoint]) {
    assert.doesNotMatch(source, /"[^"\n]*리뷰 혜택[^"\n]*"/);
  }
});
