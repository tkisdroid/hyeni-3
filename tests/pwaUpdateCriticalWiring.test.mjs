import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("PWA 업데이트는 결제·대사·주변소리의 실제 진행 상태가 끝날 때까지 보류된다", () => {
  const subscription = source("src/screens/feature/Subscription.tsx");
  const aiCredit = source("src/screens/feature/AiCredit.tsx");
  const remoteAudio = source("src/screens/feature/RemoteAudio.tsx");

  assert.match(subscription, /usePwaUpdateCriticalSection\(busy \|\| webReconciliationPending\)/);
  assert.match(
    aiCredit,
    /usePwaUpdateCriticalSection\([\s\S]*busyPack !== null[\s\S]*webReconciliationPending[\s\S]*saveSettings\.isPending[\s\S]*advancedSettingsDirty/,
  );
  assert.match(remoteAudio, /usePwaUpdateCriticalSection\(starting \|\| listening \|\| ending\)/);
  assert.match(remoteAudio, /setEnding\(true\)[\s\S]*stopThenCloseRef\.current[\s\S]*finally\(\(\) => \{/);
});

test("PWA 업데이트는 미저장 운영·계정·알림 편집과 저장 요청을 보호한다", () => {
  const admin = source("src/screens/admin/AdminAiPrompt.tsx");
  const account = source("src/screens/parent/ParentAccount.tsx");
  const notifications = source("src/screens/feature/NotificationSettings.tsx");

  assert.match(admin, /dirty \|\| commerceDirty \|\| savePrompt\.isPending \|\| saveCommerceControls\.isPending/);
  assert.match(
    account,
    /dirty[\s\S]*updateProfile\.isPending[\s\S]*changePassword\.isPending[\s\S]*deleteAccount\.isPending[\s\S]*logoutBusy/,
  );
  assert.match(notifications, /dirty \|\| saveQuietHours\.isPending \|\| save\.isPending \|\| deliveryBusy/);
});

test("PWA 업데이트는 공통 mutation과 편집 라우트·대화 초안을 보호한다", () => {
  const app = source("src/app/App.tsx");
  const memo = source("src/screens/shared/MemoChat.tsx");
  const aiFriend = source("src/screens/child/AiFriendChat.tsx");

  assert.match(app, /const activeMutationCount = useIsMutating\(\)/);
  assert.match(app, /activeMutationCount > 0 \|\| PWA_DRAFT_PROTECTED_ROUTES\.has\(location\.pathname\)/);
  for (const path of [
    "/onboarding",
    "/ai-schedule",
    "/sticker-send",
    "/event-form",
    "/place-form",
    "/danger-zone-form",
    "/pairing-wizard",
    "/child/ai-friend-setup",
    "/feedback",
    "/supplies",
  ]) {
    assert.match(app, new RegExp(`"${path.replaceAll("/", "\\/")}"`));
  }
  assert.match(memo, /draft\.trim\(\)\.length > 0 \|\| savingPhoto \|\| sharing !== "" \|\| sendMemo\.isPending/);
  assert.match(aiFriend, /input\.trim\(\)\.length > 0 \|\| sendChat\.isPending/);
});

test("PWA 중요 작업 보호 훅은 paint 전 동기 등록한다", () => {
  const hook = source("src/lib/usePwaUpdateCriticalSection.ts");

  assert.match(hook, /import \{ useLayoutEffect \} from "react"/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{/);
  assert.doesNotMatch(hook, /\buseEffect\b/);
});
