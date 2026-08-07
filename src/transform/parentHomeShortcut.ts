export interface ParentHomeDeviceFinderDestination {
  to: "/remote-ring";
  state: {
    childUserId: string | undefined;
  };
}

/** 활성 아이를 소리 울리기 대상에 명시한다. 아이가 없으면 식별자를 만들지 않는다. */
export function resolveParentHomeDeviceFinder(
  childUserId: string | null | undefined,
): ParentHomeDeviceFinderDestination {
  const normalizedChildUserId = childUserId?.trim() || undefined;
  return {
    to: "/remote-ring",
    state: { childUserId: normalizedChildUserId },
  };
}
