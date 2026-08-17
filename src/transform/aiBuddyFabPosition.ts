/**
 * 플로팅 AI 친구 버튼의 위치 계산 정본(순수 함수).
 *
 * 위치를 px 로 저장하면 기기 회전·화면 크기가 달라질 때 버튼이 프레임 밖으로 나가 사라진다.
 * 그래서 "이동 가능 영역 안의 비율(0~1)"로 저장하고, 그릴 때만 px 로 환산한다.
 * 계산을 컴포넌트에서 분리해 두면 드래그 없이도 경계 조건을 테스트할 수 있다.
 */

/** 버튼 지름. 조작 영역 최소 44px 규칙을 넉넉히 넘긴다. */
export const AI_BUDDY_FAB_SIZE = 64;

/** 프레임 가장자리와의 최소 간격(4px 리듬). */
export const AI_BUDDY_FAB_EDGE_GAP = 12;

/** 이 거리·시간 안에서 손을 떼면 드래그가 아니라 탭으로 본다. */
export const AI_BUDDY_FAB_TAP_SLOP_PX = 8;
export const AI_BUDDY_FAB_TAP_MAX_MS = 700;

export interface AiBuddyFabRatio {
  xRatio: number;
  yRatio: number;
}

export interface AiBuddyFabFrame {
  width: number;
  height: number;
  /** 상단 상태바·헤더가 가리는 높이. */
  topInset: number;
  /** 하단 독·탭바가 가리는 높이. */
  bottomInset: number;
}

/** 기본 위치 = 오른쪽 아래(엄지가 닿는 자리, 독 바로 위). */
export const DEFAULT_AI_BUDDY_FAB_RATIO: AiBuddyFabRatio = { xRatio: 1, yRatio: 0.86 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 저장된 값을 믿지 않고 항상 0~1 로 좁힌다(구버전·손상된 저장값 방어). */
export function clampAiBuddyFabRatio(ratio: AiBuddyFabRatio): AiBuddyFabRatio {
  return { xRatio: clamp01(ratio.xRatio), yRatio: clamp01(ratio.yRatio) };
}

/**
 * localStorage 등에서 읽은 임의 값 → 위치. 숫자가 아니면 null 을 돌려 기본 위치로 강등한다.
 * `Number(null) === 0` 함정을 피하려고 typeof 로 먼저 막는다.
 */
export function normalizeAiBuddyFabRatio(raw: unknown): AiBuddyFabRatio | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.xRatio !== "number" || typeof record.yRatio !== "number") return null;
  if (!Number.isFinite(record.xRatio) || !Number.isFinite(record.yRatio)) return null;
  return clampAiBuddyFabRatio({ xRatio: record.xRatio, yRatio: record.yRatio });
}

export interface AiBuddyFabTrack {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 버튼 좌상단이 놓일 수 있는 사각형. 프레임이 아주 작으면 폭·높이가 0 이 된다. */
export function aiBuddyFabTrack(frame: AiBuddyFabFrame): AiBuddyFabTrack {
  const left = AI_BUDDY_FAB_EDGE_GAP;
  const top = Math.max(0, frame.topInset) + AI_BUDDY_FAB_EDGE_GAP;
  const width = Math.max(0, frame.width - AI_BUDDY_FAB_SIZE - AI_BUDDY_FAB_EDGE_GAP * 2);
  const height = Math.max(
    0,
    frame.height - Math.max(0, frame.topInset) - Math.max(0, frame.bottomInset)
      - AI_BUDDY_FAB_SIZE - AI_BUDDY_FAB_EDGE_GAP * 2,
  );
  return { left, top, width, height };
}

export function aiBuddyFabOffset(ratio: AiBuddyFabRatio, frame: AiBuddyFabFrame): { left: number; top: number } {
  const track = aiBuddyFabTrack(frame);
  const safe = clampAiBuddyFabRatio(ratio);
  return {
    left: track.left + track.width * safe.xRatio,
    top: track.top + track.height * safe.yRatio,
  };
}

export function aiBuddyFabRatioFromOffset(
  offset: { left: number; top: number },
  frame: AiBuddyFabFrame,
): AiBuddyFabRatio {
  const track = aiBuddyFabTrack(frame);
  return clampAiBuddyFabRatio({
    xRatio: track.width > 0 ? (offset.left - track.left) / track.width : 0,
    yRatio: track.height > 0 ? (offset.top - track.top) / track.height : 0,
  });
}

/**
 * 손을 떼면 가까운 좌우 가장자리로 붙인다.
 * 화면 한가운데 떠 있으면 콘텐츠를 계속 가리므로, 아이가 놓은 높이는 지키고 좌우만 정리한다.
 */
export function snapAiBuddyFabRatio(ratio: AiBuddyFabRatio): AiBuddyFabRatio {
  const safe = clampAiBuddyFabRatio(ratio);
  return { xRatio: safe.xRatio < 0.5 ? 0 : 1, yRatio: safe.yRatio };
}

/** 드래그로 옮긴 것인지, 열려고 누른 것인지. */
export function isAiBuddyFabTap(dx: number, dy: number, elapsedMs: number): boolean {
  return Math.hypot(dx, dy) <= AI_BUDDY_FAB_TAP_SLOP_PX && elapsedMs <= AI_BUDDY_FAB_TAP_MAX_MS;
}

/** 저장 키 — 가족·아이별로 분리해 기기를 같이 쓰는 형제끼리 위치가 섞이지 않게 한다. */
export function aiBuddyFabStorageKey(familyId: string | null, userId: string | null): string {
  return `hyeni-ai-buddy-fab-v1:${familyId ?? "nofamily"}:${userId ?? "nouser"}`;
}
