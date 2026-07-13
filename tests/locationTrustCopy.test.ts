import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocationTrustCopy } from "../src/transform/locationTrustCopy.ts";

const now = new Date("2026-07-14T06:00:00.000Z");

test("프리미엄의 90초 이내 위치만 현재 위치로 안내한다", () => {
  assert.deepEqual(
    resolveLocationTrustCopy({
      mode: "realtime",
      modeKnown: true,
      updatedAt: "2026-07-14T05:59:30.000Z",
      now,
    }),
    { badge: "현재 위치", detail: "방금 갱신" },
  );
});

test("지연 또는 오래된 좌표를 실시간으로 단정하지 않는다", () => {
  const delayed = resolveLocationTrustCopy({
    mode: "delayed",
    modeKnown: true,
    updatedAt: "2026-07-14T05:44:00.000Z",
    now,
  });
  assert.equal(delayed.badge, "15분 지연 위치");
  assert.match(delayed.detail, /마지막 공개 위치/);

  const stale = resolveLocationTrustCopy({
    mode: "realtime",
    modeKnown: true,
    updatedAt: "2026-07-14T04:00:00.000Z",
    now,
  });
  assert.equal(stale.badge, "마지막 확인 위치");
  assert.doesNotMatch(`${stale.badge} ${stale.detail}`, /실시간/);
});

test("좌표나 티어가 미확정이면 현재 위치라고 표시하지 않는다", () => {
  assert.equal(
    resolveLocationTrustCopy({ mode: "realtime", modeKnown: true, updatedAt: null, now }).badge,
    "위치 신호 대기",
  );
  assert.equal(
    resolveLocationTrustCopy({ mode: "realtime", modeKnown: false, updatedAt: "2026-07-14T05:59:30Z", now }).badge,
    "마지막 확인 위치",
  );
});

test("위치 조회 범위 확인이 실패하면 캐시 좌표 대신 재확인 안내를 보여준다", () => {
  assert.deepEqual(
    resolveLocationTrustCopy({
      mode: "realtime",
      modeKnown: false,
      updatedAt: null,
      loadState: "error",
      now,
    }),
    {
      badge: "위치 조회 범위 확인 실패",
      detail: "새로고침해서 다시 확인해 주세요",
    },
  );
});

test("무료 잠금은 좌표·로딩·오류보다 먼저 위치 조회 제한으로 안내한다", () => {
  for (const loadState of ["ready", "loading", "error"] as const) {
    assert.deepEqual(
      resolveLocationTrustCopy({
        mode: "locked",
        modeKnown: true,
        updatedAt: null,
        loadState,
        now,
      }),
      { badge: "위치 조회 제한", detail: "현재 위치는 표시되지 않아요" },
    );
  }
});

test("위치 조회 로딩·오류·신호 대기·지연 위치 없음은 서로 다른 문구로 안내한다", () => {
  assert.deepEqual(
    resolveLocationTrustCopy({
      mode: "realtime",
      modeKnown: true,
      updatedAt: null,
      loadState: "loading",
      now,
    }),
    { badge: "위치 불러오는 중", detail: "위치 정보를 불러오고 있어요" },
  );
  assert.deepEqual(
    resolveLocationTrustCopy({
      mode: "realtime",
      modeKnown: true,
      updatedAt: null,
      loadState: "error",
      now,
    }),
    { badge: "위치 조회 실패", detail: "새 위치를 불러오지 못했어요" },
  );
  assert.deepEqual(
    resolveLocationTrustCopy({ mode: "realtime", modeKnown: true, updatedAt: null, now }),
    { badge: "위치 신호 대기", detail: "아이 기기의 새 위치 신호를 기다리고 있어요" },
  );
  assert.deepEqual(
    resolveLocationTrustCopy({ mode: "delayed", modeKnown: true, updatedAt: null, now }),
    { badge: "공개할 지연 위치 없음", detail: "15분 이전 위치가 아직 없어요" },
  );
});

test("기존 좌표가 있을 때 새 조회 실패는 마지막 확인 위치와 실패를 함께 알린다", () => {
  const copy = resolveLocationTrustCopy({
    mode: "realtime",
    modeKnown: true,
    updatedAt: "2026-07-14T05:55:00.000Z",
    loadState: "error",
    now,
  });
  assert.equal(copy.badge, "마지막 확인 위치");
  assert.match(copy.detail, /새 위치 조회 실패/);
  assert.match(copy.detail, /5분 전/);
});
