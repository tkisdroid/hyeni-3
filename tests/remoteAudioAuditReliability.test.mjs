import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [remoteAudio, auditScreen, auditEndpoint] = await Promise.all([
  readFile(new URL("../src/screens/feature/RemoteAudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/feature/RemoteAudioAudit.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api/endpoints/remoteAudit.ts", import.meta.url), "utf8"),
]);
const koNotifications = JSON.parse(await readFile(new URL("../locales/ko/notifications.json", import.meta.url), "utf8"));

test("원격청취는 감사 행을 먼저 확보하고 실패하면 명령을 보내지 않는다", () => {
  const auditIndex = remoteAudio.indexOf("const auditSession = await openRemoteListenSession");
  const commandIndex = remoteAudio.indexOf("res = await requestListen.mutateAsync");
  assert.ok(auditIndex >= 0 && commandIndex > auditIndex);
  assert.match(remoteAudio, /if \(!auditSession\.id\)[\s\S]*resolveRemoteListenAuditFailureState\(auditSession\)[\s\S]*return/);
  assert.match(remoteAudio, /stopThenCloseRef\.current\([\s\S]*"command_failed"/);
  assert.match(remoteAudio, /stopThenCloseRef\.current\([\s\S]*"no_target_device"/);
});

test("원격청취 종료는 같은 requestId stop을 기다린 뒤 감사 세션을 닫는다", () => {
  const helperStart = remoteAudio.indexOf("stopThenCloseRef.current = async");
  const helperEnd = remoteAudio.indexOf("const sessionRef", helperStart);
  const helper = remoteAudio.slice(helperStart, helperEnd);
  const stopIndex = helper.indexOf("await stopListenMutateAsyncRef.current");
  const closeIndex = helper.indexOf("await closeRemoteListenSession");

  assert.ok(stopIndex >= 0 && closeIndex > stopIndex);
  assert.match(helper, /finally\s*\{[\s\S]*await closeRemoteListenSession/);
  assert.match(remoteAudio, /void stopThenCloseRef\.current\(session, targetChildUserId, requestId, reason\)/);
  assert.match(remoteAudio, /void stopThenCloseRef\.current\(s, targetChildUserId, requestId, "unmount"\)/);
  assert.match(remoteAudio, /stopThenCloseRef\.current\([\s\S]*"command_failed"/);
});

test("감사 화면은 서버 기록의 로딩·오류·빈 상태·목록을 정직하게 구분한다", () => {
  assert.match(auditEndpoint, /\/api\/remote-listen\/sessions\?family_id=/);
  assert.match(auditScreen, /useRemoteListenAudit\(\)/);
  assert.match(auditScreen, /audit\.isLoading/);
  assert.match(auditScreen, /audit\.isError/);
  assert.match(auditScreen, /items\.length === 0/);
  assert.doesNotMatch(auditScreen, /const auditItems:[\s\S]*= \[\]/);
  assert.match(auditScreen, /id: "notifications\.remoteAudio\.audit\.privacyDetail"/);
  assert.match(koNotifications["notifications.remoteAudio.audit.privacyDetail"], /실시간 오디오 내용은 저장하지 않습니다/);
  assert.match(koNotifications["notifications.remoteAudio.audit.status"], /\{state,\s*select,/);
  for (const state of ["ended", "noListening", "checking", "needsReview", "other"]) {
    assert.match(koNotifications["notifications.remoteAudio.audit.status"], new RegExp(`${state}\\s*\\{`));
  }
  assert.match(koNotifications["notifications.remoteAudio.audit.listened"], /\{duration\}초 청취/);
  assert.doesNotMatch(auditScreen, /한국어 (?:표시|안전) 계약/);
});
