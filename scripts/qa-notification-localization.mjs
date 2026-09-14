/** 실제 계정·운영 API 없이 격리 브라우저에서 알림 센터의 10개 언어 표시를 확인한다. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mockApi, newDocumentScript } from "./final-browser-qa.mjs";
import { formatNotificationCopy } from "../shared/notificationCopy.ts";

const manifest = JSON.parse(await readFile(new URL("../locales/manifest.json", import.meta.url), "utf8"));
const output = resolve("artifacts/release-evidence/notification-localization");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const { code } of manifest.locales) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: code, timezoneId: "Asia/Seoul", serviceWorkers: "block" });
    const scenario = { role: "parent", tier: "premium", country: "US" };
    let copy = { v: 1, id: "arrivedFrom", args: { child: "Min", place: "Central Park", from: "Home" }, occurredAt: "2026-03-08T07:01:00.000Z", timeZone: "America/New_York" };
    const errors = [];
    await context.addInitScript({ content: newDocumentScript() + `\nlocalStorage.setItem("hyeni-locale-v1", ${JSON.stringify(code)});` });
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) return route.continue();
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) return route.abort();
      let body = null;
      try { body = req.postDataJSON(); } catch {}
      let result = mockApi(url.pathname, scenario, req.method(), body, req.headers());
      if (url.pathname === "/api/parent-alerts") result = result.map(alert => ({ ...alert, title: "학교 도착", message: "원래 한국어 알림", metadata: { notificationCopy: copy }, alert_type: copy.id === "dangerEnter" ? "danger_zone" : "place_arrived" }));
      if (url.pathname === "/api/family/mine") result = { ...result, countryCode: "US", timeZone: "America/New_York", mapPolicy: { provider: "google", countryCode: "US" } };
      await route.fulfill({ status: scenario.lastResponseCode ?? 200, json: result ?? null });
    });
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:5179/?qaRole=parent#/notifications");
      const expected = formatNotificationCopy(copy, code)?.body ?? "원래 한국어 알림";
      await page.locator(".nc-item__detail").first().waitFor();
      assert.equal(await page.locator(".nc-item__detail").first().textContent(), expected);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `notifications-${code}.png`) });
      if (code === "en") {
        await page.goto("http://127.0.0.1:5179/?qaRole=parent#/arrival-alerts");
        await page.locator(".aa-item__detail").first().waitFor();
        assert.equal(await page.locator(".aa-item__detail").first().textContent(), expected);
        copy = { ...copy, id: "dangerEnter" };
        await page.goto("http://127.0.0.1:5179/?qaRole=parent#/danger-alert");
        await page.reload(); // 다음 fixture는 새 문서의 query cache에서 시작한다.
        await page.locator(".da-hero__msg").waitFor();
        assert.equal(await page.locator(".da-hero__msg").textContent(), formatNotificationCopy(copy, code).body);
      }
      results.push({ locale: code, passed: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: "PASS", source: "isolated_static_fixtures", viewport: "390x844", results, realPushReceipt: false }));
} finally { await browser.close(); }
