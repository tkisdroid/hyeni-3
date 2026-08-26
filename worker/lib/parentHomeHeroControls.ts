/**
 * 부모 홈 히어로 캐러셀 운영 설정(운영자 전역).
 *
 * `app_global_settings` 한 행에 JSON 으로 담아 **구독/비구독 개수가 어긋난 중간 상태**를 만들지 않는다.
 * 스키마 변경이 없다(테이블·migration·health 게이트는 이미 있다).
 *
 * 값 판정 규칙은 클라이언트와 같아야 한다 — 정본은 `src/transform/parentHomeHeroCarousel.ts` 이고
 * 여기서는 같은 범위를 서버에서 다시 검사한다(요청 본문을 믿지 않는다).
 * 두 곳이 어긋나면 `tests/parentHomeHeroCarousel.test.ts` 와
 * `worker/tests/parentHomeHeroControls.test.mjs` 가 함께 깨진다.
 */
import { pgNow } from "./time.ts";

export const PARENT_HOME_HERO_CONTROLS_KEY = "parent_home_hero_carousel_v1";

/** 히어로에 둘 수 있는 슬라이드 상한. 클라이언트 `MAX_PARENT_HOME_HERO_SLIDES` 와 같아야 한다. */
export const MAX_HERO_SLIDES = 6;
export const MIN_HERO_AUTOPLAY_MS = 3000;
export const MAX_HERO_AUTOPLAY_MS = 30_000;

export interface ParentHomeHeroControls {
  freeVisibleCount: number;
  premiumVisibleCount: number;
  /** 0 이면 자동 전환하지 않는다. */
  autoPlayMs: number;
}

export interface ParentHomeHeroControlsState {
  controls: ParentHomeHeroControls;
  configured: boolean;
}

/**
 * 운영자가 설정하지 않았을 때의 기본값.
 *
 * 커머스 제어와 달리 "닫힘"이 아니라 **정상 기본값**이다. 히어로는 안전 기능이 아니라 표시 영역이고,
 * 설정 조회가 실패했다고 오늘 요약을 감추면 부모가 앱을 여는 이유가 사라진다.
 * 대신 구독 가족 기본값을 더 적게 둬서, 미설정 상태에서 구독자에게 홍보가 과하게 보이지 않게 한다.
 */
const DEFAULT_CONTROLS: ParentHomeHeroControls = Object.freeze({
  freeVisibleCount: 3,
  premiumVisibleCount: 2,
  autoPlayMs: 6000,
});

function isCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_HERO_SLIDES;
}

function isAutoPlay(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  if (value === 0) return true;
  return value >= MIN_HERO_AUTOPLAY_MS && value <= MAX_HERO_AUTOPLAY_MS;
}

/** 형식·범위가 모두 맞을 때만 수용한다. 절반만 맞는 설정은 적용하지 않는다. */
export function parseParentHomeHeroControls(value: unknown): ParentHomeHeroControls | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isCount(record.freeVisibleCount)) return null;
  if (!isCount(record.premiumVisibleCount)) return null;
  if (!isAutoPlay(record.autoPlayMs)) return null;
  return {
    freeVisibleCount: record.freeVisibleCount,
    premiumVisibleCount: record.premiumVisibleCount,
    autoPlayMs: record.autoPlayMs,
  };
}

function parseStoredControls(value: unknown): ParentHomeHeroControls | null {
  if (typeof value !== "string") return null;
  try {
    return parseParentHomeHeroControls(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * 운영 화면용 진단 조회. 행 누락·형식 오류는 `configured=false` 로 구분하고
 * D1 장애는 호출자에게 전파해 "설정된 값"으로 오인하지 않게 한다.
 */
export async function inspectParentHomeHeroControls(
  db: D1Database,
): Promise<ParentHomeHeroControlsState> {
  const row = await db.prepare(
    "SELECT value FROM app_global_settings WHERE key=? LIMIT 1",
  ).bind(PARENT_HOME_HERO_CONTROLS_KEY).first<{ value: string }>();
  const controls = parseStoredControls(row?.value);
  return controls
    ? { controls, configured: true }
    : { controls: DEFAULT_CONTROLS, configured: false };
}

/** 소비자용. 모든 오류를 기본값으로 강등한다(히어로 표시를 막지 않는다). */
export async function readParentHomeHeroControls(
  db: D1Database,
): Promise<ParentHomeHeroControls> {
  try {
    return (await inspectParentHomeHeroControls(db)).controls;
  } catch {
    console.error("[hero-controls] read failed");
    return DEFAULT_CONTROLS;
  }
}

/** 관리자 전용 라우트에서 세 값을 한 행으로 원자 갱신한다. */
export async function writeParentHomeHeroControls(
  db: D1Database,
  controls: ParentHomeHeroControls,
  updatedBy: string,
): Promise<ParentHomeHeroControls> {
  await db.prepare(
    `INSERT INTO app_global_settings (key,value,updated_by,updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_by=excluded.updated_by,
       updated_at=excluded.updated_at`,
  ).bind(PARENT_HOME_HERO_CONTROLS_KEY, JSON.stringify(controls), updatedBy, pgNow()).run();
  return controls;
}
