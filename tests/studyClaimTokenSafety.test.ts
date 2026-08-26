import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STUDY_CLAIM_KEY,
  captureStudyClaim,
  pendingStudyClaimDestination,
  requireSafeStudyAttachQrUrl,
  restoreStudyClaim,
} from "../src/transform/studyClaimContext.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

const TOKEN = "opaque-token-abcdefghijklmnopqrstuvwxyz012345";
const NOW = Date.parse("2026-08-24T00:00:00.000Z");

test("claim token을 탭 범위로 옮기고 API 호출 전에 URL과 저장값을 지운다", async () => {
  const calls: string[] = [];
  const tabStorage = memoryStorage();
  const context = captureStudyClaim(
    `#/study-management/claim?token=${TOKEN}`,
    { replace: (hash) => calls.push(`replace:${hash}`) },
    tabStorage,
    { now: () => NOW },
  );

  await context.consume((token) => {
    assert.equal(tabStorage.getItem(STUDY_CLAIM_KEY), null);
    calls.push(`post:${token}`);
    return Promise.resolve();
  });

  assert.deepEqual(calls, [
    "replace:#/study-management/claim",
    `post:${TOKEN}`,
  ]);
  assert.equal(tabStorage.getItem(STUDY_CLAIM_KEY), null);
});

test("claim은 한 번만 소비되고 만료·취소·손상 시 저장값을 남기지 않는다", async () => {
  const storage = memoryStorage();
  const context = captureStudyClaim(
    `#/study-management/claim?token=${TOKEN}`,
    { replace() {} },
    storage,
    { now: () => NOW },
  );
  await context.consume(() => Promise.resolve("ok"));
  await assert.rejects(() => context.consume(() => Promise.resolve("again")), /study_claim_already_consumed/);

  captureStudyClaim(
    `#/study-management/claim?token=${TOKEN}`,
    { replace() {} },
    storage,
    { now: () => NOW },
  );
  const expired = restoreStudyClaim(storage, { now: () => NOW + 10 * 60_000 });
  await assert.rejects(() => expired.consume(() => Promise.resolve()), /study_claim_expired/);
  assert.equal(storage.getItem(STUDY_CLAIM_KEY), null);

  const cancelled = captureStudyClaim(
    `#/study-management/claim?token=${TOKEN}`,
    { replace() {} },
    storage,
    { now: () => NOW },
  );
  cancelled.cancel();
  assert.equal(storage.getItem(STUDY_CLAIM_KEY), null);
});

test("claim URL과 저장 envelope는 엄격한 길이·문자·만료 계약을 지킨다", () => {
  const storage = memoryStorage();
  for (const hash of [
    "#/study-management/claim?token=short",
    `#/study-management/claim?token=${"a".repeat(129)}`,
    `#/study-management/claim?token=${TOKEN}%20suffix`,
    `#/study-management/claim?next=evil&token=${TOKEN}`,
  ]) {
    assert.throws(
      () => captureStudyClaim(hash, { replace() {} }, storage, { now: () => NOW }),
      /study_claim_invalid/,
    );
  }
  storage.setItem(STUDY_CLAIM_KEY, JSON.stringify({ token: "short", expiresAt: NOW + 60_000 }));
  assert.equal(pendingStudyClaimDestination("parent", storage, { now: () => NOW }), null);
  assert.equal(storage.getItem(STUDY_CLAIM_KEY), null);
});

test("유효 claim은 부모 인증 복귀만 허용하고 다른 역할에서는 즉시 폐기한다", () => {
  const storage = memoryStorage();
  captureStudyClaim(
    `#/study-management/claim?token=${TOKEN}`,
    { replace() {} },
    storage,
    { now: () => NOW },
  );
  assert.equal(
    pendingStudyClaimDestination("parent", storage, { now: () => NOW }),
    "/study-management/claim",
  );
  assert.equal(storage.getItem(STUDY_CLAIM_KEY) !== null, true);
  assert.equal(pendingStudyClaimDestination("child", storage, { now: () => NOW }), null);
  assert.equal(storage.getItem(STUDY_CLAIM_KEY), null);
});

test("attach QR은 정확한 Study origin·connect path·fragment token만 허용한다", () => {
  const valid = `https://study.hyenicalendar.com/math/connect#${TOKEN}`;
  assert.equal(requireSafeStudyAttachQrUrl(valid), valid);
  for (const url of [
    `https://evil.example/math/connect#${TOKEN}`,
    `https://study.hyenicalendar.com/math/parent-link#${TOKEN}`,
    `https://study.hyenicalendar.com/math/connect?token=${TOKEN}`,
    "https://study.hyenicalendar.com/math/connect#short",
  ]) {
    assert.throws(() => requireSafeStudyAttachQrUrl(url), /study_attach_qr_invalid/);
  }
});

test("생산 배선은 sessionStorage만 쓰고 raw token을 DOM·로그·영구 저장소에 두지 않는다", () => {
  const root = new URL("../", import.meta.url);
  const sources = [
    "src/app/App.tsx",
    "src/auth/guards.ts",
    "src/components/study/StudyClaimGate.tsx",
    "src/components/study/StudyPairingPanel.tsx",
    "src/transform/studyClaimContext.ts",
  ].map((path) => readFileSync(new URL(path, root), "utf8")).join("\n");

  assert.match(sources, /window\.sessionStorage/);
  assert.doesNotMatch(sources, /window\.localStorage|localStorage\.|console\.(?:log|info|warn|error)|data-(?:token|claim)/);
  assert.match(sources, /path: "study-management\/claim"/);
  assert.match(sources, /history\.replaceState/);

  const claimGate = readFileSync(new URL("src/components/study/StudyClaimGate.tsx", root), "utf8");
  const pairing = readFileSync(new URL("src/components/study/StudyPairingPanel.tsx", root), "utf8");
  const onboarding = readFileSync(new URL("src/screens/onboarding/Onboarding.tsx", root), "utf8");
  const nativeOAuth = readFileSync(new URL("src/lib/native/oauthDeepLink.ts", root), "utf8");
  assert.match(claimGate, /children\.length > 1[\s\S]*children\.map/);
  assert.doesNotMatch(claimGate, /useActiveChild/);
  assert.match(pairing, /!canManageLinks/);
  assert.match(onboarding, /clearPendingStudyClaim\(window\.sessionStorage\)/);
  assert.match(nativeOAuth, /mode === "login"[\s\S]*clearPendingStudyClaim\(window\.sessionStorage\)/);
});
