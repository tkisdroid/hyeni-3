import { useLayoutEffect } from "react";
import { beginPwaCriticalSection } from "./pwaUpdateCoordinator";

/** active인 동안 새 PWA 버전의 활성화·reload를 보류한다. */
export function usePwaUpdateCriticalSection(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    return beginPwaCriticalSection();
  }, [active]);
}
