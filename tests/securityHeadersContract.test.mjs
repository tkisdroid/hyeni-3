import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

test("Pages 전역 응답은 브라우저 보안 기본 헤더를 강제한다", () => {
  assert.match(headers, /^\/\*$/m);
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000; includeSubDomains/);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  assert.match(headers, /X-Frame-Options:\s*DENY/);
  assert.match(headers, /Referrer-Policy:\s*no-referrer/);
  assert.doesNotMatch(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(headers, /Permissions-Policy:\s*camera=\(self\), microphone=\(self\), geolocation=\(self\)/);
  assert.doesNotMatch(headers, /Permissions-Policy:[^\n]*\*/);
});

test("CSP는 기본 차단을 유지하면서 실제 PWA 외부 의존성만 연다", () => {
  const csp = headers.split(/\r?\n/).find((line) => line.includes("Content-Security-Policy:")) ?? "";
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ]) {
    assert.ok(csp.includes(directive), `${directive} 누락`);
  }
  for (const dependency of [
    "https://dapi.kakao.com",
    "https://js.tosspayments.com",
    "https://hyeni-calendar-api.tkisdroid.workers.dev",
    "wss://hyeni-calendar-api.tkisdroid.workers.dev",
  ]) {
    assert.ok(csp.includes(dependency), `${dependency} 누락`);
  }
  assert.doesNotMatch(csp, /default-src\s+\*/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
});

test("app-version 정책은 전역 헤더 아래에서 캐시만 별도로 닫는다", () => {
  const globalIndex = headers.indexOf("/*");
  const versionIndex = headers.indexOf("/app-version.json");
  assert.ok(globalIndex >= 0 && versionIndex > globalIndex);
  assert.match(headers.slice(versionIndex), /Cache-Control:\s*no-store/);
});
