import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../routes/remote-listen.ts", import.meta.url), "utf8");

test("원격청취 감사 목록은 가족의 활성 부모에게만 제공한다", () => {
  assert.match(source, /rl\.get\("\/sessions", requireAuth/);
  assert.match(source, /resolveVerifiedFamilyMembership\(c\.env\.DB, uid, familyId\)/);
  assert.match(source, /membership\.role !== "parent"/);
  assert.match(source, /FROM remote_listen_sessions r/);
  assert.match(source, /WHERE r\.family_id = \?/);
  assert.doesNotMatch(source, /audio_chunk|audio_data|recording_url/);
});

test("감사 행 생성은 주 보호자와 활성 대상 아이를 서버 정본으로 검증한다", () => {
  assert.match(source, /family\?\.parent_id !== uid/);
  assert.match(source, /role = 'child' AND is_active = 1/);
  assert.match(source, /\.bind\(id, familyId, uid, child\.user_id, now, now\)/);
  assert.doesNotMatch(source, /\.bind\(id, familyId, b\.initiator_user_id/);
});

test("감사 행 생성도 프리미엄·가족 킬스위치를 서버에서 먼저 검증한다", () => {
  const createStart = source.indexOf('rl.post("/sessions", requireAuth');
  const insertStart = source.indexOf("INSERT INTO remote_listen_sessions", createStart);
  assert.ok(createStart >= 0 && insertStart > createStart);
  const createBody = source.slice(createStart, insertStart);
  assert.match(createBody, /resolveFamilyEntitlement\(c\.env\.DB, familyId\)/);
  assert.match(createBody, /remote_listen_requires_premium/);
  assert.match(createBody, /remote_listen_disabled_by_family/);
  assert.match(createBody, /remote_listen_entitlement_unavailable/);
});

test("감사 종료는 동의 뒤 실제 청취시간만 계산하고 미동의 대기시간은 0초로 닫는다", () => {
  assert.match(source, /row\.consented_at\s*\?\s*remoteListenDurationMs\(row\.consented_at, nowMs\)\s*:\s*0/);
  assert.doesNotMatch(source, /row\.consented_at \?\? row\.started_at/);
  assert.match(source, /normalizeRemoteListenEndReason\(b\.end_reason\)/);
  assert.match(source, /WHERE id = \? AND ended_at IS NULL/);
  assert.doesNotMatch(source, /b\.ended_at\s*\?/);
  assert.doesNotMatch(source, /b\.duration_ms\s*\?\?/);
});

test("아이 동의 endpoint는 서버에서 1회 동의와 60초 캡처 창을 확정한다", () => {
  assert.match(source, /rl\.post\("\/sessions\/:id\/consent", requireAuth/);
  assert.match(source, /authorizeRemoteListenConsent\(c\.env\.DB/);
  assert.match(source, /capture_expires_at/);
});

test("부모는 자신이 시작한 단일 세션의 동의·캡처 만료·서버 시각만 조회한다", () => {
  assert.match(source, /rl\.get\("\/sessions\/:id", requireAuth/);
  assert.match(source, /r\.initiator_user_id = \?/);
  assert.match(source, /consented_at_ms/);
  assert.match(source, /capture_expires_at_ms/);
  assert.match(source, /server_now_ms/);
});
