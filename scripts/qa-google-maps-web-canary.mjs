/** 운영 공개 웹 키로 Google 지도만 검증한다. 가족 API·실제 위치·사용자 세션은 사용하지 않는다. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "https://hyenicalendar.com";
const html = await fetch(origin, { cache: "no-store" }).then(r => { assert.ok(r.ok); return r.text(); });
const entry = html.match(/src="((?:\.\/|\/)?assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(entry);
const bundle = await fetch(new URL(entry, origin)).then(r => { assert.ok(r.ok); return r.text(); });
const keys = [...new Set(bundle.match(/AIza[A-Za-z0-9_-]{35}/g))];
assert.equal(keys.length, 1, "운영 공개 지도 키가 유일해야 한다");
const output = resolve("artifacts/release-evidence/global-time-zone");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", locale: "en-US" });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/maps-release-canary") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="map" style="height:100vh"></div></body></html>' });
    if (/^(?:.*\.)?(?:googleapis\.com|gstatic\.com|google\.com|googleusercontent\.com)$/.test(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errorCodes = new Set();
  page.on("console", msg => {
    const code = msg.text().match(/Google Maps JavaScript API error: ([A-Za-z]+)/)?.[1];
    if (code) errorCodes.add(code);
  });
  await page.goto(`${origin}/maps-release-canary`);
  await page.evaluate(key => {
    window.gm_authFailure = () => { window.canaryAuthFailed = true; };
    window.initCanary = async () => {
      const { Map } = await google.maps.importLibrary("maps");
      const map = new Map(document.getElementById("map"), { center: { lat: 40.785091, lng: -73.968285 }, zoom: 14, mapTypeId: "roadmap" });
      google.maps.event.addListenerOnce(map, "tilesloaded", () => { window.canaryTilesLoaded = true; });
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=initCanary&language=en&region=US&v=weekly`;
    script.onerror = () => { window.canaryLoadFailed = true; };
    document.head.append(script);
  }, keys[0]);
  await page.waitForFunction(() => window.canaryTilesLoaded || window.canaryAuthFailed || window.canaryLoadFailed, null, { timeout: 30000 });
  const state = await page.evaluate(() => ({ tilesLoaded: !!window.canaryTilesLoaded, authFailed: !!window.canaryAuthFailed, loadFailed: !!window.canaryLoadFailed, errorOverlay: !!document.querySelector(".gm-err-container") }));
  assert.deepEqual(state, { tilesLoaded: true, authFailed: false, loadFailed: false, errorOverlay: false });
  assert.equal(errorCodes.size, 0);
  await page.screenshot({ path: resolve(output, "google-maps-web-canary.png") });
  console.log(JSON.stringify({ status: "PASS", source: "live_google_sdk_isolated_document", syntheticLocation: "Central Park", ...state, liveFamilyApi: false, keyValueLogged: false }));
  await context.close();
} catch {
  console.error("Google 웹 지도 실호출 검증 실패: 키·요청 URL은 기록하지 않음");
  process.exitCode = 1;
} finally {
  await browser.close();
}
