import './helpers/appModuleResolve.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const { childDeviceSilence, childDeviceSilentSince } = await import('../src/transform/childDeviceSilence.ts');
const now = new Date('2026-09-26T12:22:00Z');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('위치와 기기 보고가 모두 20분 넘게 멈추면 마지막 연락 시각을 돌려준다', () => {
  // 2026-09-26 실사례: 위치 09:55, 기기 보고 09:52 이후 무응답 — 부모 화면이 "실시간 안 됨"으로 보였다.
  const since = childDeviceSilentSince({ locationUpdatedAt: '2026-09-26 09:55:01+00', deviceReportedAt: '2026-09-26T09:52:31.421Z', now });
  assert.equal(since?.toISOString(), '2026-09-26T09:55:01.000Z');
});

test('하나라도 최근이면 폰 연결 문제로 단정하지 않는다', () => {
  assert.equal(childDeviceSilentSince({ locationUpdatedAt: '2026-09-26 09:55:01+00', deviceReportedAt: '2026-09-26T12:15:00Z', now }), null);
  assert.equal(childDeviceSilentSince({ locationUpdatedAt: '2026-09-26 12:10:00+00', deviceReportedAt: null, now }), null);
  assert.equal(childDeviceSilentSince({ locationUpdatedAt: null, deviceReportedAt: null, now }), null);
});

test('전원 종료 신호와 배터리로 방전·전원 끔·저전력을 구분한다', () => {
  // 2026-09-26 TK 제보: 배터리가 닳아서 꺼져도 부모가 알 수 없었다.
  const base = { locationUpdatedAt: '2026-09-26 09:55:01+00', now };
  const dead = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 4, shutdownAt: '2026-09-26T09:58:00Z', shutdownBatteryLevel: 1 } });
  assert.equal(dead?.cause, 'batteryDead');
  assert.equal(dead?.since.toISOString(), '2026-09-26T09:58:00.000Z');
  assert.equal(dead?.batteryLevel, 1);

  const off = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 75, shutdownAt: '2026-09-26T09:58:00Z', shutdownBatteryLevel: 74 } });
  assert.equal(off?.cause, 'poweredOff');

  const low = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 6, isCharging: false } });
  assert.equal(low?.cause, 'lowBattery');
  assert.equal(low?.batteryLevel, 6);

  const unknown = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 75 } });
  assert.equal(unknown?.cause, 'unknown');

  // 이전 앱은 꺼질 때 배터리를 보내지 않는다 — 마지막 보고가 저전력이면 방전으로 본다.
  const legacyDead = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 8, shutdownAt: '2026-09-26T09:58:00Z' } });
  assert.equal(legacyDead?.cause, 'batteryDead');
  const legacyOff = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 60, shutdownAt: '2026-09-26T09:58:00Z' } });
  assert.equal(legacyOff?.cause, 'poweredOff');

  // 예전 꺼짐 기록(마지막 연락보다 한참 전)은 이번 끊김의 원인이 아니다.
  const staleShutdown = childDeviceSilence({ ...base, health: { updatedAt: '2026-09-26T09:52:00Z', batteryLevel: 75, shutdownAt: '2026-09-25T09:00:00Z' } });
  assert.equal(staleShutdown?.cause, 'unknown');
});

test('부모 위치·기기 찾기·홈 카드가 같은 원인 문구를 쓴다', () => {
  const location = read('src/screens/parent/ParentLocation.tsx');
  const ring = read('src/screens/feature/RemoteRing.tsx');
  const home = read('src/screens/parent/ParentHome.tsx');
  for (const source of [location, ring, home]) {
    assert.match(source, /childDeviceSilence\(/);
    assert.match(source, /parent\.deviceSilence\.status/);
  }
  assert.match(location, /parent\.deviceSilence\.refreshTimeout/);
  assert.match(ring, /parent\.deviceSilence\.ringNotice/);
  assert.match(ring, /parent\.deviceSilence\.lastLocation/);
  const ko = JSON.parse(read('locales/ko/parent.json'));
  assert.match(ko['parent.deviceSilence.status'], /batteryDead \{\{time\}에 배터리가 다 돼서 꺼졌어요\}/);
});
