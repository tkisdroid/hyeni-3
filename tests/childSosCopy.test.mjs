import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const koChild = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/child.json"), "utf8"));

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("SOS 는 3초 홀드 안내를 반말로 명확히 말한다(시안 2a)", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /id: "child\.sos\.mainTitle"/);
  assert.match(childSos, /id="child\.sos\.mainDescription"/);
  assert.match(childSos, /id: progress > 0 \? "child\.sos\.keepHolding" : "child\.sos\.hintHold"/);
  // 2026-08-17 TK 지시: "도와 줘!"는 아이가 비명 지르는 말투다.
  // 실제로 하는 일(부모에게 도움 요청)을 반말로 말한다.
  assert.equal(koChild["child.sos.mainTitle"], "부모님께 도움을 요청할게");
  assert.doesNotMatch(koChild["child.sos.mainTitle"], /도와 ?줘/);
  assert.match(koChild["child.sos.mainDescription"], /<strong>3초<\/strong>.*<strong>내 위치<\/strong>/);
  assert.equal(koChild["child.sos.hintHold"], "3초 꾹");
  assert.doesNotMatch(koChild["child.sos.mainDescription"], /알려요|놀라요|갈래요/);
  assert.doesNotMatch(childSos, /i18n 안전 문구 불변식/);
});

test("SOS 발사 계약은 그대로다 — 3초 홀드 · 세션당 1회 · alertSent 확인", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /const HOLD_MS = 3000/);
  assert.match(childSos, /sentRef\.current = true/);
  assert.match(childSos, /result\.alertSent \? "sent" : "error"/);
  // 위치는 홀드 시작 때 읽고, 실패해도 알림은 나간다.
  assert.match(childSos, /acquirePosition\(\)/);
});

test("서버 접수 성공을 보호자 기기 표시 완료로 단정하지 않는다", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");

  assert.match(childSos, /id: "child\.sos\.accepted"/);
  assert.match(childSos, /id: "child\.sos\.acceptedDescription"/);
  assert.match(childSos, /id: "child\.sos\.notificationStarted"/);
  assert.equal(koChild["child.sos.accepted"], "SOS를 접수했어!");
  assert.match(koChild["child.sos.acceptedDescription"], /전송을 시작했어/);
  assert.equal(koChild["child.sos.notificationStarted"], "보호자에게 알림 전송을 시작했어");
  assert.doesNotMatch(
    Object.values(koChild).filter((value) => typeof value === "string").join("\n"),
    /보호자 모두에게 알림이 갔어|위치는 못 찾았지만 알림은 갔어|에게 알렸어!/,
  );
});

test("부모 홈에는 '꾹' 스티커 UI 를 되살리지 않는다(2026-07-09 TK 결정)", () => {
  const parentHome = readSource("src/screens/parent/ParentHome.tsx");
  assert.doesNotMatch(parentHome, /꾹/);
});

test("아이 SOS 3초 누르기는 포인터를 캡처해 미세 이동으로 중단되지 않는다", () => {
  const childSos = readSource("src/screens/child/ChildSos.tsx");
  const holdButtonStart = childSos.indexOf('className="cs-hold hy-press"');
  const holdButton = childSos.slice(holdButtonStart, childSos.indexOf("</button>", holdButtonStart));

  assert.match(childSos, /setPointerCapture\(event\.pointerId\)/);
  assert.match(childSos, /releasePointerCapture\(event\.pointerId\)/);
  assert.doesNotMatch(holdButton, /onPointerLeave/);
});

test("SOS 부모 알림은 같은 멱등키로 일시 실패를 한 번 재시도한다", () => {
  const endpoint = readSource("src/lib/api/endpoints/sos.ts");

  assert.match(endpoint, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(endpoint, /event_id:\s*requestHash/);
  assert.match(endpoint, /error\.status >= 500/);
  assert.match(endpoint, /postParentSosAlert\(/);
  assert.match(endpoint, /SOS_ALERT_ATTEMPT_TIMEOUT_MS = 8_000/);
  assert.match(endpoint, /apiPost\("\/api\/parent-alerts", body, \{ signal: controller\.signal \}\)/);
});

test("부모 알림함에 남는 SOS 원문은 누가 무엇을 요청했는지 존댓말로 말한다", () => {
  // 2026-09-26 실기기: 한국어 알림함은 서버 번역(notificationCopy) 대신 원문을 보여 준다.
  // "도와줘요!"·"아이야님이 SOS를 보냈어요" 는 부모용 존댓말·번역 카탈로그와 어긋났다.
  const sos = readSource("src/lib/api/endpoints/sos.ts");
  const catalog = readSource("shared/generated/notificationCatalog.ts");
  assert.doesNotMatch(sos, /도와줘요|님이 SOS/);
  assert.match(sos, /title: `🆘 \$\{name\} 긴급 도움 요청`/);
  assert.match(sos, /message: `\$\{subject\} 긴급 도움을 요청했어요\. 위치를 확인하고 연락해 주세요\.`/);
  assert.match(catalog, /"sos": "\{child\}가 긴급 도움을 요청했어요\. 위치를 확인하고 연락해 주세요\."/);
  // 받침 있는 이름은 "민준이가" — 도착 알림(worker/lib/arrivalDetect.ts)과 같은 조사 규칙.
  assert.match(sos, /\(last - 0xac00\) % 28 !== 0 \? `\$\{name\}이가` : `\$\{name\}가`/);
});

test("SOS 뒤 아이 화면은 보호자 확인을 보여 주고 성별 미지정 보호자에게도 전화할 수 있다", () => {
  // 2026-09-26 S20: 부모가 안전 확인을 눌러도 아이 화면은 "전송을 시작했어"에 머물렀고,
  // 성별을 정하지 않은 보호자뿐인 가족은 전화 버튼이 하나도 없었다.
  const childSos = readSource("src/screens/child/ChildSos.tsx");
  const sosReceive = readSource("src/screens/feature/SosReceive.tsx");
  assert.match(sosReceive, /origin: "sos_ack"/);
  assert.match(childSos, /reply\.origin !== "sos_ack" \|\| reply\.user_role !== "parent"/);
  assert.match(childSos, /useMemoThread\(phase === "sent" && todayKey \? \[todayKey\] : \[\], ownMemberId\)/);
  assert.match(childSos, /id: guardianAcked \? "child\.sos\.guardianAcked" : "child\.sos\.guardianPending"/);
  assert.match(childSos, /const callTargets = parents\.map\(/);
  assert.doesNotMatch(childSos, /callParent\("mom"|callParent\("dad"/);
  assert.equal(koChild["child.sos.guardianAcked"], "보호자가 확인했어. 곧 연락이 올 거야");
  assert.doesNotMatch(koChild["child.sos.goHome"], /집으로/);
});

test("부모 긴급 수신 화면은 SOS가 오면 위치를 바로 다시 받는다", () => {
  // 2026-09-26 실기기(무료): 서버는 SOS 중 child_locations 최신값을 주지만, 앱이 30초 폴링을 기다려 첫 화면이 "8분 전"이었다.
  const sosReceive = readSource("src/screens/feature/SosReceive.tsx");
  assert.match(sosReceive, /refetch: refetchLocations/);
  assert.match(sosReceive, /if \(!latestAlertId\) return;\s*void refetchLocations\(\);[\s\S]{0,80}setTimeout\(\(\) => void refetchLocations\(\), 4_000\)/);
});
