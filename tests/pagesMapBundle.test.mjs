import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectPagesMapBundle } from "../scripts/verify-pages-map-bundle.mjs";

function fixture(run) {
  const root=mkdtempSync(join(tmpdir(),"hyeni-map-bundle-"));
  mkdirSync(join(root,"assets"));
  const write=(name,value)=>writeFileSync(join(root,name),value);
  write("index.html",'<script src="./assets/index-fixture.js"></script>');
  write("assets/index-fixture.js",`const key="AIza${"x".repeat(35)}";const routes=["/api/maps/search","/api/maps/reverse","/api/maps/directions"];`);
  for(const name of ["FamilyMap","GoogleMapAdapter","GoogleNativeMapAdapter"])write(`assets/${name}-fixture.js`,"export {};");
  write("_headers","https://maps.googleapis.com https://maps.gstatic.com https://fonts.googleapis.com");
  try{run(root,write)}finally{rmSync(root,{recursive:true,force:true})}
}
test("지도 공급자·키·API·CSP가 포함된 배포물만 통과한다",()=>fixture(root=>assert.equal(inspectPagesMapBundle(root).status,"PASS")));
test("Google 웹 키가 빠진 빌드는 차단한다",()=>fixture((root,write)=>{write("assets/index-fixture.js","");assert.throws(()=>inspectPagesMapBundle(root),/지도 키 누락/)}));
test("구형 Kakao 전용 배포물을 차단한다",()=>fixture(root=>{rmSync(join(root,"assets/GoogleMapAdapter-fixture.js"));assert.throws(()=>inspectPagesMapBundle(root),/지도 청크 누락/)}));
test("Google 글꼴을 막는 CSP를 차단한다",()=>fixture((root,write)=>{write("_headers","https://maps.googleapis.com https://maps.gstatic.com");assert.throws(()=>inspectPagesMapBundle(root),/fonts.googleapis.com CSP/)}));
