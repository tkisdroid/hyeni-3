import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const koNotifications = JSON.parse(source("locales/ko/notifications.json"));

test("부모 알림 시간은 본인과 정확히 연결된 아이를 명시 선택한다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");

  assert.match(parent, /useFamilyNotificationQuietHours/);
  assert.match(parent, /useSaveNotificationQuietHours/);
  assert.match(parent, /useMyFamily/);
  assert.match(parent, />내 알림</);
  assert.match(parent, /member\.user_id/);
  assert.match(parent, /recipient\.targetUserId/);
  assert.match(parent, /아이 기기 연결이 필요해요/);
  assert.match(parent, /aria-pressed=\{selected/);
  assert.doesNotMatch(parent, /children\s*\[\s*0\s*\]/);
  assert.doesNotMatch(parent, /setActiveChild|useActiveChild/);
});

test("부모 알림 시간 편집기는 한 개의 매일 반복 구간을 명시 적용한다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");

  assert.equal((parent.match(/type="time"/g) ?? []).length, 2);
  assert.match(parent, /시작 시간/);
  assert.match(parent, /끝 시간/);
  assert.match(parent, /role="switch"/);
  assert.match(parent, /aria-checked=\{/);
  // 저장 버튼은 "적용"으로 바뀌었고 문구는 카탈로그가 정본이다.
  assert.match(parent, /notifications.settings.quiet.apply/);
  assert.equal(koNotifications["notifications.settings.quiet.apply"], "적용");
  assert.match(parent, /시작 시간과 끝 시간을 다르게 선택해 주세요/);
  assert.match(parent, /dirty/);
  assert.match(parent, /isPending/);
  assert.match(parent, /aria-live="polite"/);
  assert.doesNotMatch(parent, /localStorage/);
});

test("quiet 저장 응답은 제출 target과 draft가 그대로일 때만 현재 UI에 반영한다", async () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");
  const quietTransform = await import("../src/transform/notificationQuietHours.ts");
  const isSameDraft = quietTransform.isSameNotificationQuietHoursTargetDraft;
  const submitted = {
    targetUserId: "parent-1",
    enabled: true,
    startMinute: 1320,
    endMinute: 420,
  };

  assert.equal(typeof isSameDraft, "function");
  assert.equal(isSameDraft(submitted, { ...submitted }), true);
  assert.equal(isSameDraft(submitted, { ...submitted, targetUserId: "child-1" }), false);
  assert.equal(isSameDraft(submitted, { ...submitted, startMinute: 1260 }), false);
  assert.match(parent, /submittedQuietDraft/);
  assert.match(parent, /quietDraftRef/);
  assert.ok((parent.match(/isSameNotificationQuietHoursTargetDraft/g) ?? []).length >= 3);
});

test("quiet cache hydration은 마지막 서버 source와 비교해 사용자 재편집을 보존한다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");

  assert.match(parent, /quietServerSourceRef/);
  assert.match(parent, /resolveNotificationQuietHoursSourceUpdate/);
  assert.match(parent, /quietServerSourceRef\.current\s*=\s*resolution\.source/);
  assert.match(parent, /setQuietDraft\(resolution\.draft\)/);
});

test("조용한 시간 설명은 억제 범위와 안전 예외 및 기기 설정 경계를 분리한다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");

  // ①무엇이 멈추는지 ②안전 알림은 그대로 온다 ③소리·진동은 기기 설정이다 — 세 문장을 따로 남긴다.
  // 문구는 화면이 아니라 카탈로그가 정본이라 id 배선과 ko 값을 함께 확인한다(2026-08-18 정리).
  for (const id of [
    "notifications.settings.quiet.suppressed",
    "notifications.settings.quiet.safetyExceptions",
    "notifications.settings.deviceSoundNote",
  ]) {
    assert.match(parent, new RegExp(id.replace(/\./g, "\\.")));
    assert.ok(koNotifications[id]?.trim(), `${id} 문구가 필요합니다`);
  }
  assert.match(koNotifications["notifications.settings.quiet.suppressed"], /알림을 보내지 않아요/);
  assert.match(koNotifications["notifications.settings.quiet.safetyExceptions"], /SOS·긴급·위험구역/);
  assert.match(koNotifications["notifications.settings.deviceSoundNote"], /소리·진동/);
  // 소리·진동을 이 토글이 제어하는 것처럼 말하지 않는다.
  assert.doesNotMatch(parent, /알림 소리·진동과 방해금지는/);
});

test("조용한 시간 설명은 공통 설명문 조판을 사용하고 caption으로 덮지 않는다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");
  const css = source("src/screens/feature/NotificationSettings.css");
  const components = source("src/styles/components.css");
  const quietCopyRule = /\.nst-quiet__copy\s*\{([^}]*)\}/s.exec(css)?.[1] ?? "";

  assert.match(parent, /className="nst-quiet__copy hy-explain"/);
  assert.doesNotMatch(quietCopyRule, /font-size|font-weight|line-height/);
  assert.match(components, /\.hy-explain\.hy-explain\s*\{[^}]*font-size:\s*var\(--type-body-sm\)[^}]*font-weight:\s*var\(--type-body-sm-weight\)[^}]*word-break:\s*keep-all[^}]*overflow-wrap:\s*anywhere[^}]*text-wrap:\s*pretty/s);
  assert.match(components, /\.hy-explain\.hy-explain\s*\{\s*line-height:\s*1\.55;/s);
});

test("새 가족 quiet 조회 오류는 기존 알림 설정 화면 전체를 막지 않는다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");

  assert.match(parent, /quietHoursQuery\.isError/);
  assert.match(parent, /quietHoursQuery\.refetch/);
  assert.match(parent, /조용한 시간 설정을 불러오지 못했어요/);
  assert.match(parent, /다시 확인/);
});

test("아이 설정은 부모가 정한 시간을 본인 row에서 읽기만 한다", () => {
  const child = source("src/screens/child/ChildSettings.tsx");

  assert.match(child, /notificationQuietHoursRange/);
  assert.match(child, /notifSettings\.quietHours/);
  assert.match(child, /부모님이 정한 거/);
  assert.match(child, /알림 쉬는 시간이 설정되지 않았어/);
  assert.match(child, /알림을 쉬어/);
  assert.doesNotMatch(child, /useSaveNotificationQuietHours/);
  assert.doesNotMatch(child, /type="time"/);
});

test("quiet 편집기는 44px 조작 영역과 360px 한 열을 보장한다", () => {
  const css = source("src/screens/feature/NotificationSettings.css");

  assert.match(css, /\.nst-quiet__time-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.nst-quiet[^}]*min-height:\s*var\(--control-min-size\)/s);
  assert.match(css, /\.nst-quiet__time[^}]*min-width:\s*0[^}]*width:\s*100%/s);
  assert.match(css, /@media\s*\(max-width:\s*360px\)[\s\S]*?\.nst-quiet__time-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("운영 문서는 알림 조용한 시간 정본과 배포 순서를 보존한다", () => {
  const docs = `${source("AGENTS.md")}\n${source("docs/engineering/contracts.md")}\n${source("docs/engineering/operations.md")}`;

  assert.match(docs, /notification quiet hours/i);
  assert.match(docs, /부모 본인[^\n]*user_id[^\n]*활성 아이/);
  assert.match(docs, /22:00[^\n]*07:00/);
  assert.match(docs, /Asia\/Seoul/);
  assert.match(docs, /pending_notifications[^\n]*(이전|전에)/);
  assert.match(docs, /suppressed_quiet_hours/);
  assert.match(docs, /SOS[^\n]*미도착[^\n]*위험구역/);
  assert.match(docs, /kkuk[^\n]*(일반|억제)/);
  assert.match(docs, /notification-quiet-hours\.sql[^\n]*Worker[^\n]*(이전|전에)/);
  assert.match(docs, /A17[^\n]*(부모|parent)/i);
  assert.match(docs, /razr[^\n]*(아이|child)/i);
  assert.match(docs, /adb install --user 0 -r/);
  assert.match(docs, /S25[^\n]*(부모|parent)/i);
  assert.match(docs, /S20 Ultra[^\n]*(아이|child)/i);
});
