import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("PWA는 자체 service worker에서 push와 안전한 알림 클릭 경로를 처리한다", () => {
  const vite = read("vite.config.ts");
  const sw = read("src/sw.ts");
  assert.match(vite, /strategies:\s*["']injectManifest["']/);
  assert.match(vite, /srcDir:\s*["']src["']/);
  assert.match(sw, /addEventListener\(["']push["']/);
  assert.match(sw, /addEventListener\(["']notificationclick["']/);
  assert.match(sw, /ALLOWED_ROUTES/);
  assert.match(sw, /targetUserId/);
  assert.match(sw, /familyId/);
  assert.match(sw, /data: \{ pushId, route, familyId, targetUserId, targetRole \}/);
  assert.match(sw, /if \(!targetMatches\(notificationData \?\? \{\}, context\)\) return/);
});

test("웹 푸시는 명시적 구독·해제와 로그인 세션 context 동기화를 제공한다", () => {
  const module = read("src/lib/webPush.ts");
  const bootstrap = read("src/app/NativeBootstrap.tsx");
  const worker = read("src/sw.ts");
  assert.match(module, /ensureWebPushSubscription/);
  assert.match(module, /unsubscribeWebPush/);
  assert.match(module, /syncWebPushSessionContext/);
  assert.match(module, /\/api\/push-subscriptions\/status\?endpoint=/);
  assert.match(module, /status\?endpoint=\$\{encodeURIComponent\(endpoint\)\}[\s\S]{0,120}registration_instance_id=/);
  assert.match(module, /accountRegistered/);
  assert.match(module, /existingRegistered === false[\s\S]{0,220}subscription\.unsubscribe\(\)/);
  assert.match(module, /registration_instance_id:\s*registrationInstanceId/);
  assert.match(module, /isApiError\([^)]+\)[\s\S]{0,80}status === 409/);
  assert.match(module, /endpoint_conflict/);
  assert.match(module, /unsubscribe_failed/);
  assert.match(module, /if \(!unsubscribed\)/);
  assert.doesNotMatch(module, /await apiRequest\([\s\S]{0,240}\)\.catch\(\(\) => null\)/);
  assert.match(module, /new MessageChannel\(\)/);
  assert.match(module, /HYENI_PUSH_CONTEXT_ACK/);
  assert.match(module, /Notification\.requestPermission/);
  assert.match(bootstrap, /syncWebPushSessionContext/);
  assert.match(worker, /event\.ports\[0\]/);
  assert.match(worker, /HYENI_PUSH_CONTEXT_ACK/);
});

test("service worker가 표시한 pushId는 bounded 장부로 남겨 foreground pending 재표시 없이 ACK한다", () => {
  const sw = read("src/sw.ts");
  const module = read("src/lib/webPush.ts");
  const bootstrap = read("src/app/NativeBootstrap.tsx");

  const showIndex = sw.indexOf("await self.registration.showNotification");
  const recordAfterShowIndex = sw.indexOf("await recordShownPushId(pushId, context)", showIndex);
  assert.ok(showIndex >= 0, "OS 알림 표시 호출이 있어야 합니다");
  assert.ok(recordAfterShowIndex > showIndex, "표시에 성공한 뒤 pushId를 기록해야 합니다");
  assert.match(sw, /SHOWN_PUSH_IDS_KEY/);
  assert.match(sw, /mergeShownPushIds/);

  const clickBody = sw.slice(sw.indexOf('addEventListener("notificationclick"'));
  assert.match(clickBody, /await recordShownPushId\(pushId, context\)/);

  assert.match(module, /export async function wasWebPushDisplayed/);
  assert.match(bootstrap, /wasWebPushDisplayed\(input\.stableId, \{ familyId, userId \}\)/);
  assert.match(bootstrap, /acknowledged:\s*true,\s*displayed:\s*false/);
});

test("new_memo 웹 푸시는 대상·만료 검사 뒤 서버 재인가에 성공한 경우에만 표시·기록한다", () => {
  const sw = read("src/sw.ts");
  const targetIndex = sw.indexOf("if (!context || !targetMatches(data, context)) return;");
  const expiryIndex = sw.indexOf("if (isPushExpired(data.expiresAt, Date.now())) return;", targetIndex);
  const authorizeIndex = sw.indexOf("await authorizeMemoDisplay(", expiryIndex);
  const showIndex = sw.indexOf("await self.registration.showNotification", expiryIndex);
  const ledgerIndex = sw.indexOf("await recordShownPushId(pushId, context)", showIndex);

  assert.ok(targetIndex >= 0, "현재 로그인 대상 확인이 필요합니다");
  assert.ok(expiryIndex > targetIndex, "대상 확인 뒤 만료를 검사해야 합니다");
  assert.ok(authorizeIndex > expiryIndex, "만료 검사 뒤 new_memo 표시를 서버에 재인가해야 합니다");
  assert.ok(showIndex > authorizeIndex, "재인가 성공 뒤에만 알림을 표시해야 합니다");
  assert.ok(ledgerIndex > showIndex, "실제 표시 뒤에만 shown ledger를 기록해야 합니다");
  assert.match(sw, /data\.memoDisplayPermit/);
});
