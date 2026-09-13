import './helpers/appModuleResolve.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { confirmedDataTimestamp, scopedDaySummary } = await import('../src/transform/auditStateScope.ts');

test('동기화 시각은 두 조회가 모두 완료된 경우에만 더 오래된 확인 시각을 사용한다', () => {
  assert.equal(confirmedDataTimestamp(0, 1000), null);
  assert.equal(confirmedDataTimestamp(1000, 0), null);
  assert.equal(confirmedDataTimestamp(NaN, 1000), null);
  assert.equal(confirmedDataTimestamp(1000, 2000)?.getTime(), 1000);
});

test('하루 요약은 가족·아이·날짜가 모두 같아야 표시하며 지연된 다른 대상 결과를 거부한다', () => {
  const result = { scope: ['가족A', '아이A', '2026-09-07'], value: { summary: 'A의 요약' } };
  assert.equal(scopedDaySummary(result, ['가족A', '아이A', '2026-09-07']), result.value);
  for (const scope of [['가족B', '아이A', '2026-09-07'], ['가족A', '아이B', '2026-09-07'], ['가족A', '아이A', '2026-09-08']]) {
    assert.equal(scopedDaySummary(result, scope), null);
  }
  assert.equal(scopedDaySummary(null, result.scope), null);
});
