import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatPhoneDisplay, formatPhoneOrMissing } from "../src/transform/phoneFormat.ts";
import { homePlaceCenter, resolveMapCenter, SEOUL_CENTER } from "../src/transform/mapCenter.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("전화번호는 저장 형식과 무관하게 같은 표시로 통일된다", () => {
  // 실사용 데이터: 계정 화면만 하이픈 없이 보였다(2026-07-30 A17 확인).
  assert.equal(formatPhoneDisplay("01083018128"), "010-8301-8128");
  assert.equal(formatPhoneDisplay("010-8301-8128"), "010-8301-8128");
  assert.equal(formatPhoneDisplay(" 010 8301 8128 "), "010-8301-8128");
  // 입력 중 부분값도 자연스럽게 끊는다.
  assert.equal(formatPhoneDisplay("010"), "010");
  assert.equal(formatPhoneDisplay("0108"), "010-8");
  assert.equal(formatPhoneDisplay("0108301"), "010-8301");
  // 11자리 초과는 잘라낸다.
  assert.equal(formatPhoneDisplay("010833018128999"), "010-8330-18128".slice(0, 13));
  assert.equal(formatPhoneDisplay(null), "");
  assert.equal(formatPhoneOrMissing(null), "미등록");
  assert.equal(formatPhoneOrMissing(""), "미등록");
  assert.equal(formatPhoneOrMissing("01012345678"), "010-1234-5678");
});

test("전화번호 포맷은 화면마다 복제하지 않고 공용 모듈을 쓴다", () => {
  for (const path of [
    "src/screens/parent/ParentAccount.tsx",
    "src/screens/feature/ProfileEdit.tsx",
    "src/screens/feature/PhoneSetup.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /from "@\/transform\/phoneFormat"/, `${path} 공용 포맷터 미사용`);
    assert.doesNotMatch(source, /function formatPhone(?:Display)?\(/, `${path} 로컬 포맷터 잔존`);
  }
});

test("지도 기본 중심은 현재 위치 > 집 > 아이 위치 > 서울 순서다", () => {
  const current = { lat: 37.3, lng: 127.1 };
  const home = [{ is_home: true, location: { lat: 37.25, lng: 127.05 } }];
  const child = [{ lat: 37.4, lng: 127.2 }];

  assert.deepEqual(resolveMapCenter({ current, places: home, childLocations: child }), current);
  assert.deepEqual(resolveMapCenter({ places: home, childLocations: child }), { lat: 37.25, lng: 127.05 });
  assert.deepEqual(resolveMapCenter({ childLocations: child }), { lat: 37.4, lng: 127.2 });
  assert.deepEqual(resolveMapCenter({}), SEOUL_CENTER);
  // 0,0·NaN 같은 무효 좌표는 건너뛴다.
  assert.deepEqual(
    resolveMapCenter({ current: { lat: 0, lng: 0 }, childLocations: [{ lat: null, lng: 1 }, ...child] }),
    { lat: 37.4, lng: 127.2 },
  );
  assert.equal(homePlaceCenter([]), null);
  assert.deepEqual(homePlaceCenter([{ location: { lat: 36.5, lng: 127.4 } }]), { lat: 36.5, lng: 127.4 });
});

test("장소·위험구역 등록 지도는 공용 중심 폴백을 쓴다", () => {
  for (const path of [
    "src/screens/feature/PlaceForm.tsx",
    "src/screens/feature/DangerZoneForm.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /resolveMapCenter\(\{/, `${path} 중심 폴백 미적용`);
    assert.match(source, /center=\{mapCenter\}/, `${path} 지도에 폴백 미전달`);
  }
});

test("AI 친구는 빈 응답을 대답한 척하지 않는다", () => {
  const chat = read("src/screens/child/AiFriendChat.tsx");
  assert.doesNotMatch(chat, /res\.reply \|\|/);
  assert.match(chat, /const reply = String\(res\.reply \?\? ""\)\.trim\(\);/);
  assert.match(chat, /지금은 대답을 못 받았어/);
  // 정직 안내 메시지는 신고 대상(서버 저장 id)이 아니다.
  const fallbackBlock = chat.slice(chat.indexOf("지금은 대답을 못 받았어") - 200, chat.indexOf("지금은 대답을 못 받았어") + 80);
  assert.doesNotMatch(fallbackBlock, /reportable: true/);
});

test("주변 소리 기록의 0초 세션은 '청취 없이 종료'로 정확히 표기한다", () => {
  const audit = read("src/screens/feature/RemoteAudioAudit.tsx");
  assert.match(audit, /청취 없이 종료/);
  assert.match(audit, /\$\{durationSec\}초 청취/);
  // 라벨 자체에 "N초 후 종료" 표기가 남아 있지 않은지(주석 인용은 허용).
  assert.doesNotMatch(audit, /label: `\$\{durationSec\}초 후 종료`/);
});
