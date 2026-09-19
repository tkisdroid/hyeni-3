/** 운영 공개 웹 키로 Google 지도만 검증한다. 가족 API·실제 위치·사용자 세션은 사용하지 않는다. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "https://hyenicalendar.com";
const keySource = process.env.MAPS_QA_KEY_SOURCE || origin;
const html = await fetch(keySource, { cache: "no-store" }).then(r => { assert.ok(r.ok); return r.text(); });
const entry = html.match(/src="((?:\.\/|\/)?assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(entry);
const bundle = await fetch(new URL(entry, keySource)).then(r => { assert.ok(r.ok); return r.text(); });
const keys = [...new Set(bundle.match(/AIza[A-Za-z0-9_-]{35}/g))];
assert.equal(keys.length, 1, "운영 공개 지도 키가 유일해야 한다");
const output = resolve("artifacts/release-evidence/global-time-zone");
await mkdir(output, { recursive: true });
const appHeaders = await readFile(new URL("../public/_headers",import.meta.url),"utf8");
const csp = appHeaders.split("\n").find(line=>line.trim().startsWith("Content-Security-Policy:")).trim().slice("Content-Security-Policy:".length).trim();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", locale: "en-US" });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/maps-release-canary") return route.fulfill({ headers: { "Content-Security-Policy":csp, "Referrer-Policy":"no-referrer" }, contentType: "text/html", body: '<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="map" style="height:100vh"></div></body></html>' });
    if (/^(?:.*\.)?(?:googleapis\.com|gstatic\.com|google\.com|googleusercontent\.com)$/.test(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errorCodes = new Set();
  page.on("console", msg => {
    const code = msg.text().match(/Google Maps JavaScript API error: ([A-Za-z]+)/)?.[1];
    if (code) errorCodes.add(code);
  });
  await page.addInitScript(()=>{
    window.canaryViolations=[];
    document.addEventListener("securitypolicyviolation",event=>{
      let host;try{host=new URL(event.blockedURI).hostname}catch{host=event.blockedURI}
      window.canaryViolations.push({directive:event.effectiveDirective,host});
    });
  });
  await page.goto(`${origin}/maps-release-canary`);
  await page.evaluate(key => {
    window.gm_authFailure = () => { window.canaryAuthFailed = true; };
    window.initCanary = async () => {
      const { Map } = await google.maps.importLibrary("maps");
      const map = new Map(document.getElementById("map"), { center: { lat: 40.785091, lng: -73.968285 }, zoom: 14, mapTypeId: "roadmap" });
      window.canaryMap = map;
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
  assert.deepEqual(await page.evaluate(()=>window.canaryViolations),[]);
  const countryCoordinates = [
    ["JP",35.6812,139.7671], ["TW",25.0330,121.5654], ["HK",22.3193,114.1694],
    ["SG",1.3521,103.8198], ["VN",21.0285,105.8542], ["TH",13.7563,100.5018],
    ["ID",-6.2088,106.8456], ["MY",3.1390,101.6869], ["PH",14.5995,120.9842],
    ["US",40.7851,-73.9683], ["GB",51.5074,-0.1278], ["AU",-33.8688,151.2093],
  ];
  const passedCountries = [];
  for (const [country, lat, lng] of countryCoordinates) {
    await page.evaluate(({lat,lng}) => new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error("tiles_timeout")),20000);
      google.maps.event.addListenerOnce(window.canaryMap,"tilesloaded",()=>{clearTimeout(timer);resolve();});
      window.canaryMap.setCenter({lat,lng});
    }), {lat,lng});
    assert.equal(await page.locator(".gm-err-container").count(),0);
    passedCountries.push(country);
  }
  assert.equal(errorCodes.size,0);
  assert.deepEqual(await page.evaluate(()=>window.canaryViolations),[]);
  await page.screenshot({ path: resolve(output, "google-maps-web-canary.png") });
  console.log(JSON.stringify({ status: "PASS", source: "live_google_sdk_isolated_document", syntheticLocations: passedCountries, locationScope: "해외 좌표이며 현지 접속 검증은 아님", ...state, liveFamilyApi: false, keyValueLogged: false }));
  await context.close();
} catch (error) {
  if(error?.actual)console.error(JSON.stringify(error.actual));
  console.error("Google 웹 지도 실호출 검증 실패: 키·요청 URL은 기록하지 않음");
  process.exitCode = 1;
} finally {
  await browser.close();
}
