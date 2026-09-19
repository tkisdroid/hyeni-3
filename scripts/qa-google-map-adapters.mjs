/** 실제 React 지도 컴포넌트의 실패·재시도·핀 선택·native 비동기 정리를 격리 검증한다. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = process.env.MAPS_QA_ORIGIN || "http://127.0.0.1:5198";
const output = new URL("../artifacts/google-maps-audit-20260920/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const mock = `
window.qa = { creates:0, destroys:0, loads:0, focus:[], zooms:[], pans:[], pads:[], markers:[], removed:[], fail:false, delay:0 };
class Map {
 constructor(host, options){ qa.creates++; this.host=host; this.zoom=options.zoom; host.textContent='Google 지도 검증'; qa.map=this; }
 setOptions(){} setCenter(point){qa.focus.push(point)} getZoom(){return this.zoom} setZoom(zoom){this.zoom=zoom;qa.zooms.push(zoom)}
 panBy(x,y){qa.pans.push({x,y})} fitBounds(){} addListener(name,fn){qa.click=fn;return {remove(){qa.listenerRemoved=true}}}
}
class Overlay { constructor(options){qa.markers.push(options.position);this.options=options} setMap(){} }
class LatLngBounds {extend(){}}
window.google = { maps: { Map, Marker:Overlay, Circle:Overlay, Polyline:Overlay, LatLngBounds } };
`;
const nativeMock = `
export class LatLngBounds { constructor(value){Object.assign(this,value)} async extend(){return this} }
export const GoogleMap={async create(){
 qa.creates++; if(qa.delay) await new Promise(r=>setTimeout(r,qa.delay));
 return {
 async destroy(){qa.destroys++}, async setOnMapClickListener(fn){qa.nativeClick=fn}, async setOnCameraIdleListener(fn){qa.idle=fn},
 async enableTouch(){}, async disableTouch(){}, async setPadding(p){qa.pads.push(p)},
 async setCamera(p){qa.focus.push(p.coordinate);if(p.zoom)qa.zooms.push(p.zoom)},
 async addMarkers(markers){qa.markers.push(...markers.map(m=>m.coordinate));if(qa.markerDelay)await new Promise(r=>setTimeout(r,qa.markerDelay));return ['marker']},
 async removeMarkers(ids){qa.removed.push(...ids)}, async addCircles(){return ['circle']}, async removeCircles(){},
 async addPolylines(){return ['line']}, async removePolylines(){}, async fitBounds(){}
 }
}};
`;
async function pageFor(kind, config = {}) {
 const context = await browser.newContext({ viewport:{width:390,height:844}, serviceWorkers:"block" });
 const page = await context.newPage();
 page.setDefaultTimeout(10000);
 const errors = [];
 page.on("pageerror", error => {errors.push(error.message); console.error(error.message)});
 await context.addInitScript({content:mock + `Object.assign(qa,${JSON.stringify(config)});`});
 await context.route("**/*", async route => {
  const url=new URL(route.request().url());
  if(url.origin!==origin) return route.abort();
  if(url.pathname==="/maps-adapter-qa") return route.fulfill({contentType:"text/html",body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/googleMapHarness.tsx"></script></body></html>`});
  if(url.pathname==="/src/lib/googleMaps.ts") return route.fulfill({contentType:"text/javascript",body:`export async function loadGoogleMaps(){qa.loads++;if(qa.fail){qa.fail=false;throw Error('fixture')}return {maps:google.maps,marker:google.maps}}`});
  if(url.pathname==="/src/lib/native/googleMaps.ts") return route.fulfill({contentType:"text/javascript",body:`export async function preflightGoogleMaps(){if(qa.fail){qa.fail=false;return {configured:false}}return {configured:true,playServicesStatus:'available'}}`});
  if(url.pathname.includes("@capacitor_google-maps.js")) return route.fulfill({contentType:"text/javascript",body:nativeMock});
  return route.continue();
 });
 await page.goto(`${origin}/maps-adapter-qa?${kind}`);
 await page.locator("#pick").waitFor();
 return {page,context,errors};
}
try {
 for (const kind of ["web", "native"]) {
  const {page,context,errors}=await pageFor(kind,{fail:true});
  console.log(`${kind}: 재시도 검사`);
  await page.getByRole("button",{name:"Retry"}).click();
  await page.waitForFunction(()=>qa.creates===1 && qa.focus.length>0);
  await page.locator(".km-skeleton").waitFor({state:"detached"});
  assert.equal(await page.locator(".km-error").count(),0,`${kind}: 재시도 복구`);
  const focusBefore=await page.evaluate(()=>qa.focus.length);
  await page.click("#pick");
  await page.waitForFunction(()=>qa.markers.some(p=>p?.lat===35.682));
  assert.equal(await page.evaluate(()=>qa.creates),1,`${kind}: 핀 선택이 지도를 재생성하면 안 됨`);
  assert.equal(await page.evaluate(()=>qa.focus.length),focusBefore,`${kind}: 핀 선택 뒤 지도 이동 금지`);
  await page.evaluate(kind=>{if(kind==='web')qa.map.zoom=19;else qa.idle({zoom:19});},kind);
  await page.click("#recenter");
  await page.waitForFunction(before=>qa.focus.length>before,focusBefore);
  assert.equal(await page.evaluate(()=>qa.zooms.includes(15)),false,`${kind}: 사용자 확대를 축소하면 안 됨`);
  if(kind==='web') assert.deepEqual(await page.evaluate(()=>qa.pans.at(-1)),{x:0,y:60});
  else assert.equal(await page.evaluate(()=>qa.pads.at(-1).bottom),160);
  await page.click("#move");
  await page.waitForFunction(()=>qa.focus.at(-1)?.lng===-73.9683);
  await page.screenshot({path:new URL(`${kind}-adapter.png`,output).pathname});
  await page.click("#toggle");
  if(kind==='native') {
   await page.waitForFunction(()=>qa.destroys===1);
   assert.equal(await page.locator("#surface").evaluate(el=>el.style.background),"rgb(20, 30, 40)");
   assert.equal(await page.evaluate(()=>document.body.style.background),"");
  } else assert.equal(await page.evaluate(()=>qa.listenerRemoved),true);
  assert.deepEqual(errors,[]);
  checks.push(`${kind}: 실패 재시도·핀 선택·확대·여백·해외 좌표·화면 이탈 통과`);
  await context.close();
 }
 const delayed=await pageFor("native",{markerDelay:200});
 await delayed.page.waitForFunction(()=>qa.focus.length>0);
 await delayed.page.click("#pick");
 await delayed.page.waitForFunction(()=>qa.markers.length>0);
 await delayed.page.click("#toggle");
 await delayed.page.waitForFunction(()=>qa.destroys===1);
 assert.equal(await delayed.page.evaluate(()=>document.body.classList.contains("hy-native-map-surface")),false);
 assert.deepEqual(delayed.errors,[]);
 checks.push("native: marker 갱신 중 화면 이탈 후 순차 해제 통과");
 await delayed.context.close();
 const {page,context,errors}=await pageFor("native",{delay:250});
 await page.waitForFunction(()=>qa.creates===1);
 await page.click("#toggle");
 await page.waitForFunction(()=>qa.destroys===1);
 assert.equal(await page.evaluate(()=>document.body.style.background),"");
 assert.equal(await page.locator(".km-error").count(),0);
 assert.deepEqual(errors,[]);
 checks.push("native: 생성 중 화면 이탈 후 늦은 surface 제거 통과");
 const styles=await page.evaluate(()=>{
  const parent=document.createElement('div'),a=document.createElement('div'),b=document.createElement('div');
  parent.style.backgroundColor='red';parent.style.color='blue';a.style.backgroundImage='linear-gradient(red,blue)';
  parent.append(a,b);document.body.append(parent);
  const before=parent.style.cssText,childBefore=a.style.cssText;
  const first=window.acquireNativeMapTransparency(a),second=window.acquireNativeMapTransparency(b);
  first.release();const kept=parent.style.backgroundColor==='transparent' && b.style.backgroundColor==='transparent';
  parent.style.color='green';second.release();second.release();
  return {kept,parent:parent.style.backgroundColor,child:a.style.cssText===childBefore,color:parent.style.color,before,classesCleared:![parent,a,b].some(el=>el.classList.contains('hy-native-map-surface'))};
 });
 assert.equal(styles.kept,true);assert.equal(styles.parent,'red');assert.equal(styles.child,true);assert.equal(styles.color,'green');assert.equal(styles.classesCleared,true);
 checks.push("native: 중첩 지도 배경 참조계수·원래 개별 CSS·중복 해제 통과");
 await context.close();
 await writeFile(new URL("adapters.json",output),JSON.stringify({status:"PASS",checks,liveFamilyApi:false},null,2));
 console.log(JSON.stringify({status:"PASS",checks},null,2));
} finally { await browser.close(); }
