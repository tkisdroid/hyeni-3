/** 로컬 dist의 실제 Service Worker 표시 경로만 검사한다. 푸시 사업자·실기기 수신 증거는 아니다. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ permissions: ["notifications"] });
try {
  // 빈 로컬 문서에서만 시작해 앱 계정 초기화와 운영 요청을 만들지 않는다.
  await context.route("**/__notification_qa__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>격리 알림 QA</title>" }));
  await context.route(/https:\/\/.*/, route => route.abort());
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5182/__notification_qa__");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  async function message(data) {
    return page.evaluate(async data => {
      const registration = await navigator.serviceWorker.ready;
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(Error("알림 설정 ACK 시간 초과")), 10000);
        channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        registration.active.postMessage(data, [channel.port2]);
      });
    }, data);
  }
  assert.equal((await message({ type: "HYENI_PUSH_CONTEXT", context: { userId: "qa-parent", familyId: "qa-family", role: "parent" } })).ok, true);
  assert.equal((await message({ type: "HYENI_LOCALE", locale: "en" })).ok, true);
  const payload = { title: "원제목", body: "원문", data: { familyId: "qa-family", targetUserId: "qa-parent", targetRole: "parent", pushId: "qa-translated", type: "parent_alert", route: "/notifications", notificationCopy: JSON.stringify({ v: 1, id: "arrived", args: { child: "Min", place: "Park" } }) } };
  async function dispatch(value) {
    // waitUntil 완료를 직접 기다려 검사 타이밍을 임의 sleep에 의존하지 않는다.
    await worker.evaluate(async value => {
      const event = new PushEvent("push", { data: JSON.stringify(value) });
      let pending;
      event.waitUntil = promise => { pending = promise; };
      self.dispatchEvent(event);
      await pending;
    }, value);
  }
  await dispatch(payload);
  const displayed = await worker.evaluate(async () => (await self.registration.getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, data: n.data })));
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].title, "Location update");
  assert.equal(displayed[0].body, "Min arrived at Park.");
  assert.equal(displayed[0].tag, "qa-translated");
  assert.equal(displayed[0].data.route, "/notifications");
  await dispatch({ ...payload, data: { ...payload.data, pushId: "wrong-family", familyId: "other-family" } });
  await dispatch({ ...payload, data: { ...payload.data, pushId: "expired", expiresAt: "2020-01-01T00:00:00Z" } });
  assert.equal(await worker.evaluate(async () => (await self.registration.getNotifications()).length), 1);
  await message({ type: "HYENI_LOCALE", locale: "ko" });
  await dispatch({ ...payload, data: { ...payload.data, pushId: "legacy-ko" } });
  const raw = await worker.evaluate(async () => (await self.registration.getNotifications()).find(n => n.tag === "legacy-ko")?.body);
  assert.equal(raw, "원문");
  await worker.evaluate(async () => { for (const n of await self.registration.getNotifications()) n.close(); });
  console.log(JSON.stringify({ status: "PASS", source: "local_dist_service_worker", checks: ["localized_display", "stable_id_route", "family_target", "expiry", "korean_preserved"], realPushReceipt: false }));
} finally { await context.close(); await browser.close(); }
