/**
 * 일정 제목 → 3D 캐릭터 에셋 매핑.
 * 장소관리(resolvePlaceVisual)와 같은 키워드 테이블을 쓰는 단일 출처 위임 —
 * "태권도 학원"(장소)과 "태권도 시범단"(일정)이 같은 도복 캐릭터로 보이게 한다.
 */
import { resolveEventVisualAsset } from "./placeVisual.ts";

export const DEFAULT_EVENT_CHARACTER = "cat/other.webp";

export function resolveEventCharacter(title: string | null | undefined, category?: string | null): string {
  return resolveEventVisualAsset(title, category);
}
