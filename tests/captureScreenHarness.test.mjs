import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

const captureScreen = source("scripts/capture-screen.mjs");
const browserQa = source("scripts/final-browser-qa.mjs");

test("디자인 캡처는 운영 API·실기기에 접근하지 않는다", () => {
  // 외부 호스트를 resolver 에서 닫는다 — 실계정·실서버에 절대 나가지 않는다.
  assert.match(
    captureScreen,
    /--host-resolver-rules=MAP \* ~NOTFOUND, EXCLUDE 127\.0\.0\.1/,
    "외부 호스트 차단 규칙이 있어야 한다",
  );
  // 모든 요청을 가로채 fixture 로 닫는다.
  assert.match(captureScreen, /Fetch\.enable[\s\S]*urlPattern: "\*"/);
  // 실기기 제어는 이 도구의 일이 아니다 — 띄우는 프로세스는 Chrome 하나뿐이어야 한다.
  const spawned = [...captureScreen.matchAll(/\bspawn\(([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
  assert.deepEqual(spawned, ["chrome"], "Chrome 외의 프로세스를 띄우지 않는다");
  // 격리 프로필을 쓰고 끝나면 지운다(사용자 기본 프로필 오염 금지).
  assert.match(captureScreen, /--user-data-dir=\$\{profileDir\}/);
  assert.match(captureScreen, /rm\(profileDir, \{ recursive: true, force: true \}\)/);
});

test("디자인 캡처는 표시 언어를 한국어로 고정한다", () => {
  // ⚠️ --lang 만으로는 부족하다. 앱은 navigator.languages 를 읽고 그 값은 --accept-lang 이 정한다
  // (2026-08-19 QA 하니스 실사고와 같은 함정).
  assert.match(captureScreen, /"--lang=ko-KR"/);
  assert.match(captureScreen, /"--accept-lang=ko-KR,ko"/);
});

test("디자인 캡처는 사용자 브라우저 상태를 심지 않는다", () => {
  // 세션은 QA 하니스의 newDocumentScript 하나로만 만든다(직접 저장소 조작 금지).
  for (const forbidden of ["process.env", "document.cookie", "sessionStorage"]) {
    assert.ok(!captureScreen.includes(forbidden), `${forbidden} 를 쓰지 않는다`);
  }
  assert.match(captureScreen, /newDocumentScript\(\)/);
});

test("디자인 캡처는 출시 QA 하니스의 fixture 를 그대로 재사용한다", () => {
  // 두 도구가 다른 데이터로 렌더하면 디자인 판정이 QA 결과와 어긋난다.
  assert.match(captureScreen, /import \{ mockApi, newDocumentScript \} from "\.\/final-browser-qa\.mjs"/);
  assert.match(browserQa, /export function mockApi\(/, "QA 하니스가 fixture 를 export 해야 한다");
  assert.match(browserQa, /export function newDocumentScript\(/, "QA 하니스가 세션 시드를 export 해야 한다");
});

test("디자인 캡처는 화면 전체 높이를 한 장으로 담는다", () => {
  // 뷰포트만 찍으면 스크롤이 긴 화면의 구성을 볼 수 없다 — QA 하니스와 다른 이유로 존재한다.
  assert.match(captureScreen, /captureBeyondViewport: true/);
  assert.match(captureScreen, /screen\.scrollHeight/);
  // BootSplash(1.6s) 게이트를 지나야 실제 화면이 나온다.
  assert.match(captureScreen, /await wait\(6_500\)/);
  // 렌더 크래시는 조용히 넘기지 않는다.
  assert.match(captureScreen, /\.hy-crash/);
});
