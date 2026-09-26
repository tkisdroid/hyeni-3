import './helpers/appModuleResolve.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { toReverseCoordinate } = await import('../src/lib/mapActions.ts');

// 배포된 서버의 이전 검사와 새 검사 — 둘 다 통과해야 지도 탭 주소가 채워진다.
const legacyServerAccepts = (value) => Math.abs(value * 1e7 - Math.round(value * 1e7)) < 1e-7;
const currentServerAccepts = (value) => Number(value.toFixed(7)) === value;

test('지도 탭 원좌표(15자리)를 서버가 받는 7자리 좌표로 1cm 이내에서 바꾼다', () => {
  // 2026-09-26 S25: 장소 등록에서 지도를 눌러도 주소 칸이 비었다(400 map_coordinates_invalid).
  assert.equal(legacyServerAccepts(37.33208123456789), false);
  for (let i = 0; i < 20000; i += 1) {
    const raw = -180 + Math.random() * 360;
    const value = toReverseCoordinate(raw);
    assert.ok(legacyServerAccepts(value), `이전 서버 검사 거부: ${raw} → ${value}`);
    assert.ok(currentServerAccepts(value), `새 서버 검사 거부: ${raw} → ${value}`);
    assert.ok(Math.abs(value - raw) <= 3.5e-7, `1cm 넘게 움직였다: ${raw} → ${value}`);
  }
  // 경도 130대처럼 곱셈 오차가 큰 구간도 이웃 값으로 통과시킨다.
  assert.ok(legacyServerAccepts(toReverseCoordinate(130.958332)));
});
