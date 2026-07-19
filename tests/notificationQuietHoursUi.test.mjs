import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.match(parent, />적용</);
  assert.match(parent, /시작 시간과 끝 시간을 다르게 선택해 주세요/);
  assert.match(parent, /dirty/);
  assert.match(parent, /isPending/);
  assert.match(parent, /aria-live="polite"/);
  assert.doesNotMatch(parent, /localStorage/);
});

test("조용한 시간 설명은 억제 범위와 안전 예외 및 기기 설정 경계를 분리한다", () => {
  const parent = source("src/screens/feature/NotificationSettings.tsx");

  assert.match(parent, /조용한 시간에는 일정·메시지·일반 도착·출발 알림을 보내지 않아요\./);
  assert.match(parent, /SOS·긴급·위험구역 알림은 이 시간에도 항상 전달돼요\./);
  assert.match(parent, /알림 소리와 진동은 휴대폰 또는 브라우저 설정에서 관리해 주세요\./);
  assert.doesNotMatch(parent, /알림 소리·진동과 방해금지는/);
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
