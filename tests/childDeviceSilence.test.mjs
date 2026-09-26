import './helpers/appModuleResolve.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const { childDeviceSilentSince } = await import('../src/transform/childDeviceSilence.ts');
const now = new Date('2026-09-26T12:22:00Z');

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

test('부모 위치 화면은 무응답 시각과 확인할 것을 말한다', () => {
  const source = readFileSync(new URL('../src/screens/parent/ParentLocation.tsx', import.meta.url), 'utf8');
  assert.match(source, /childDeviceSilentSince\(/);
  assert.match(source, /parent\.location\.deviceSilentSince/);
  assert.match(source, /notifications\.locationStatus\.toast\.deviceSilent/);
});
