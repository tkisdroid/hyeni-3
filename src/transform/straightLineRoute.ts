/**
 * 도보 경로를 못 받았을 때의 정직한 강등.
 *
 * 상류 라우팅(카카오 제휴 API·OSRM)이 죽으면 예전에는 "길을 못 찾았어"만 띄웠다.
 * 아이는 목적지가 얼마나 먼지조차 모른 채 끝난다. 좌표는 이미 둘 다 있으므로
 * **직선 거리**는 언제나 계산할 수 있다.
 *
 * ⚠️ 이건 경로가 아니라 직선이다. 그래서
 *  · 화면 문구에 "직선"임을 반드시 밝힌다(지어낸 경로로 오해하면 아이가 건물로 걸어간다)
 *  · 폴리라인을 그리지 않는다(직선을 그리면 그 길로 가라는 뜻이 된다)
 *  · 턴바이턴 안내를 만들지 않는다
 *  · 지도 앱 버튼을 함께 둬서 실제 길은 거기서 보게 한다
 */
// node --test 가 확장자 없는 상대 import 를 못 읽는다 — locationHistoryScrub 과 같은 규칙.
import { distanceMeters } from "./locationView.ts";

export interface StraightLineHint {
  /** 직선 거리(m). */
  distanceM: number;
  /** 도보 환산 분(4km/h ≈ 66.7m/분). 실제 경로는 이보다 길다. */
  minutes: number;
}

/** 도보 환산 기준 — RouteSheet 의 추정 계산과 같은 값을 쓴다. */
const WALK_METERS_PER_MINUTE = 66.7;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 출발·도착 좌표로 직선 거리 힌트를 만든다.
 * 좌표가 하나라도 없거나 유효하지 않으면 null — 숫자를 지어내지 않는다.
 */
export function straightLineHint(
  origin: { lat: number; lng: number } | null | undefined,
  destination: { lat: number; lng: number } | null | undefined,
): StraightLineHint | null {
  if (!origin || !destination) return null;
  // Number(null)===0 함정 — typeof 로 막지 않으면 적도·본초자오선 좌표가 만들어진다.
  if (!isFiniteNumber(origin.lat) || !isFiniteNumber(origin.lng)) return null;
  if (!isFiniteNumber(destination.lat) || !isFiniteNumber(destination.lng)) return null;

  const distanceM = Math.round(distanceMeters(origin.lat, origin.lng, destination.lat, destination.lng));
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  return { distanceM, minutes: Math.max(1, Math.round(distanceM / WALK_METERS_PER_MINUTE)) };
}
