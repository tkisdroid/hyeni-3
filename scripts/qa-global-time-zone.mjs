/** 격리 프로필과 정적 API fixture로 해외 가족 시간대 설정 UI를 검증한다. 운영 API에는 접속하지 않는다. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { mockApi, newDocumentScript } from "./final-browser-qa.mjs";

const output = resolve("artifacts/release-evidence/global-time-zone");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", timezoneId: "Asia/Seoul", serviceWorkers: "block" });
const scenario = { role: "parent", tier: "premium", country: "US" };
let timeZone = "America/Los_Angeles";
let countryCode = "US";
const writes = [];
const errors = [];
await context.addInitScript({ content: newDocumentScript() });
await context.route("**/*", async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) return route.continue();
  if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) return route.abort();
  let body = null;
  try { body = req.postDataJSON(); } catch {}
  if (url.pathname === "/api/family/region" && req.method() === "PATCH") {
    writes.push(body);
    timeZone = body.timeZone; countryCode = body.countryCode;
    return route.fulfill({ json: { countryCode, timeZone, mapPolicy: { provider: "google", countryCode } } });
  }
  let result = mockApi(url.pathname, scenario, req.method(), body, req.headers());
  if (url.pathname === "/api/family/mine") result = { ...result, countryCode, timeZone, mapPolicy: { provider: "google", countryCode } };
  await route.fulfill({ status: scenario.lastResponseCode ?? 200, json: result ?? null });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:5179/?qaRole=parent#/parent/settings");
  await page.getByText("America/Los_Angeles", { exact: false }).waitFor();
  await page.locator("button").filter({hasText:"America/Los_Angeles"}).click();
  const country = page.locator("#family-map-country");
  await country.fill("NP");
  const select = page.locator("select").filter({has: page.locator('option[value="Asia/Katmandu"]')});
  assert.ok(await select.locator("option").count() > 400);
  await select.selectOption("Asia/Katmandu");
  await page.locator(".ps-language__panel button.hy-btn--primary").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".ps-nav__value")].some(el => el.textContent.includes("Asia/Katmandu")));
  assert.deepEqual(writes, [{countryCode:"NP",timeZone:"Asia/Katmandu"}]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(output,"family-time-zone.png") });
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({status:"PASS",source:"isolated_static_fixtures",browserZone:"Asia/Seoul",familyZones:["America/Los_Angeles","Asia/Katmandu"],viewport:"390x844",checks:4,liveGoogleApi:false})+"\n");
} finally {
  await context.close();
  await browser.close();
}
