import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAIL_JITTER_M,
  buildTrailPoints,
  resolveHistoryMapCenter,
  resolveScrubWhereLabel,
} from "../src/transform/locationHistoryScrub.ts";
import type { LocationHistoryPoint } from "../src/lib/api/endpoints/location.ts";

const CHILD = "child-a";

/** D1 실제 포맷("2026-07-29 07:12:34.567+00")으로 이력 행을 만든다. */
function row(
  hm: string,
  lat: number,
  lng: number,
  options: { estimated?: boolean | number; accuracyM?: number | null; userId?: string } = {},
): LocationHistoryPoint {
  return {
    user_id: options.userId ?? CHILD,
    lat,
    lng,
    recorded_at: `2026-07-29 ${hm}+00`,
    accuracy_m: options.accuracyM === undefined ? 20 : options.accuracyM,
    is_estimated: options.estimated ?? 0,
  } as LocationHistoryPoint;
}

test("차량 이동 구간의 직선 보간 채움점은 이동선에서 제외하고 실측점만 잇는다", () => {
  // 2026-07-29 16시대 실제 패턴 재현: 실측 fix 사이를 12m 간격 채움점이 메운다.
  const history: LocationHistoryPoint[] = [
    row("07:00:00.000", 37.5172, 127.0473), // 실측(출발)
    ...Array.from({ length: 8 }, (_, i) =>
      row(`07:00:${String(10 + i * 2).padStart(2, "0")}.000`, 37.5172 - (i + 1) * 0.004, 127.0473 - (i + 1) * 0.003, {
        estimated: 1,
        accuracyM: null,
      }),
    ),
    row("07:00:30.000", 37.4800, 127.0200), // 실측(다음 fix)
  ];

  const trail = buildTrailPoints(history, CHILD);

  assert.equal(trail.length, 2, "채움점이 이동선에 남았다");
  assert.deepEqual(
    trail.map((p) => [p.lat, p.lng]),
    [
      [37.5172, 127.0473],
      [37.48, 127.02],
    ],
  );
  // 남은 두 실측점은 채움점이 놓였던 직선의 양 끝이라 실선 하나로 이어도 기하가 같다.
  assert.ok(trail[0].ms < trail[1].ms, "시간순 정렬 유지");
});

test("저정확도·정확도 미보고 실측점은 이동선에서 숨기지 않는다", () => {
  const trail = buildTrailPoints(
    [
      row("07:00:00.000", 37.5, 127.0, { accuracyM: 110 }),
      row("07:05:00.000", 37.52, 127.03, { accuracyM: null }),
    ],
    CHILD,
  );

  assert.equal(trail.length, 2);
});

test("다른 아이 좌표와 8m 이내 지터는 이동선에 넣지 않는다", () => {
  const trail = buildTrailPoints(
    [
      row("07:00:00.000", 37.5, 127.0),
      row("07:00:20.000", 37.500_01, 127.000_01), // 약 1.4m — 지터
      row("07:01:00.000", 37.5, 127.0, { userId: "child-b" }),
      row("07:02:00.000", 37.502, 127.002),
    ],
    CHILD,
  );

  assert.equal(TRAIL_JITTER_M, 8);
  assert.equal(trail.length, 2);
});

test("지도 중심은 머문 곳 선택 > 고른 시각 위치 > 하루 전체(bounds) 순서다", () => {
  const stay = { lat: 37.43, lng: 126.99 };
  const scrub = { lat: 37.5, lng: 127.03 };

  assert.deepEqual(
    resolveHistoryMapCenter({ followsLatest: false, stayCenter: stay, scrubChildPoint: scrub }),
    stay,
  );
  assert.deepEqual(
    resolveHistoryMapCenter({ followsLatest: false, stayCenter: null, scrubChildPoint: scrub }),
    scrub,
  );
  // 최신 따라가기에서는 중심을 비워 하루 경로 전체가 보이게 한다.
  assert.equal(
    resolveHistoryMapCenter({ followsLatest: true, stayCenter: null, scrubChildPoint: scrub }),
    null,
  );
  assert.equal(
    resolveHistoryMapCenter({ followsLatest: false, stayCenter: null, scrubChildPoint: null }),
    null,
  );
});

test("고른 시각 설명은 머문 곳 창·이동 중·기록 없음을 정직하게 구분한다", () => {
  const stays = [
    { arrivalMs: 1_000, departureMs: 2_000 },
    { arrivalMs: 5_000, departureMs: 6_000 },
  ];
  const labels = ["집", null];
  const label = (scrubMs: number, lastPointMs: number | null) =>
    resolveScrubWhereLabel({ stays, stayLabels: labels, scrubMs, lastPointMs });

  assert.equal(label(1_500, 6_000), "집");
  assert.equal(label(5_500, 6_000), "머문 장소");
  assert.equal(label(3_000, 6_000), "이동 중");
  assert.equal(label(3_000, null), "기록 없음");
  // 마지막 기록 이후 시각을 골라도 "이동 중"으로 단정하지 않고 마지막 확인 상태를 말한다.
  assert.equal(label(9_000, 6_000), "머문 장소");
  assert.equal(label(9_000, 1_500), "집");
});
