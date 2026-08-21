import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { resolveCorsOrigin } = await import("../lib/corsOrigin.ts");

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("CORS는 배포 PWA·Android WebView·고정 로컬 개발 origin만 허용한다", () => {
  for (const origin of [
    "https://hyenicalendar.com",
    "https://www.hyenicalendar.com",
    "https://hyeni-calendar.pages.dev",
    "https://localhost",
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]) {
    assert.equal(resolveCorsOrigin(origin), origin);
  }
  for (const origin of [
    "",
    "https://evil.example",
    "https://hyenicalendar.com.evil.example",
    "https://www.hyenicalendar.com.evil.example",
    "https://hyeni-calendar.pages.dev.evil.example",
    "https://preview.hyeni-calendar.pages.dev",
    "http://localhost.evil.example:5173",
  ]) {
    assert.equal(resolveCorsOrigin(origin), undefined);
  }
});

test("Worker 전역 CORS는 요청 origin 반사나 wildcard로 되돌아가지 않는다", () => {
  const source = read("index.ts");
  const pushSource = read("routes/push-notify.ts");
  assert.match(source, /import \{ resolveCorsOrigin \} from "\.\/lib\/corsOrigin"/);
  assert.match(source, /origin:\s*resolveCorsOrigin/);
  assert.doesNotMatch(source, /origin:\s*\([^)]*\)\s*=>/);
  assert.doesNotMatch(source, /origin:\s*["']\*["']/);
  assert.doesNotMatch(pushSource, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
});

test("OAuth와 FCM 관측 로그는 provider 응답 본문·예외 원문을 저장하지 않는다", () => {
  const oauth = read("routes/oauth.ts");
  const naver = read("routes/naver-auth.ts");
  const fcm = read("lib/fcm.ts");

  assert.doesNotMatch(oauth, /errBody|error_description\s*\|\|/);
  assert.doesNotMatch(oauth, /console\.error\([^\n]*,\s*err\)/);
  assert.doesNotMatch(naver, /console\.error\([^\n]*,\s*err\)/);
  assert.doesNotMatch(fcm, /console\.error\([^\n]*(?:tokenData|errBody|,\s*err\))/);
  assert.doesNotMatch(fcm, /error:\s*String\(err\)/);
});

test("공개 오류 응답은 provider·DB·설정 예외 원문을 반환하지 않는다", () => {
  const paths = [
    "index.ts",
    "routes/ai.ts",
    "routes/ai-child-chat.ts",
    "routes/merge-oauth.ts",
    "routes/naver-auth.ts",
    "routes/oauth.ts",
    "routes/push-notify.ts",
    "routes/rest-shim-rpc.ts",
  ];
  const violations = [];
  for (const path of paths) {
    const lines = read(path).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/return\s+(?:c\.json|jsonResponse)\(/.test(line)) return;
      if (/detail[s]?\s*:|error\s*:\s*String\(|not configured/.test(line)) {
        violations.push(`${path}:${index + 1}:${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, []);
});

test("헬스와 전역 500 응답은 고정 오류 코드만 공개한다", () => {
  const source = read("index.ts");
  assert.match(source, /error: "health_check_failed", reason: "schema_not_ready"/);
  assert.match(source, /error: "health_check_failed", reason: "database_unavailable"/);
  assert.match(source, /return c\.json\(\{ error: "internal" \}, 500\)/);
  assert.doesNotMatch(source, /\{ error: "internal", detail:/);
});
