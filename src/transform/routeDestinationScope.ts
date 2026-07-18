/**
 * 길찾기 목적지 state는 반드시 계산 대상 아이 member id와 함께 보관한다.
 * 현재 아이와 owner가 다르면 이전 아이의 목적지를 한 프레임도 노출하지 않는다.
 */
export interface OwnedRouteDestination<T> {
  ownerChildMemberId: string;
  /** undefined=해석 중, null=목적지 없음, T=해석 완료. */
  value: T | null | undefined;
}

export function beginRouteDestinationScope<T>(
  ownerChildMemberId: string,
): OwnedRouteDestination<T> {
  return { ownerChildMemberId, value: undefined };
}

/** 비동기 결과는 시작할 때 캡처한 owner가 현재 state owner와 같을 때만 반영한다. */
export function resolveRouteDestination<T>(
  state: OwnedRouteDestination<T> | null,
  ownerChildMemberId: string,
  value: T | null,
): OwnedRouteDestination<T> | null {
  if (!state || state.ownerChildMemberId !== ownerChildMemberId) return state;
  return { ownerChildMemberId, value };
}

/** 현재 아이와 owner가 다르면 loading(undefined)으로 fail-closed한다. */
export function selectRouteDestinationForChild<T>(
  state: OwnedRouteDestination<T> | null,
  childMemberId: string | null,
): T | null | undefined {
  if (!childMemberId || state?.ownerChildMemberId !== childMemberId) return undefined;
  return state.value;
}
