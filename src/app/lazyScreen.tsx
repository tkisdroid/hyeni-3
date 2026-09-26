import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { reloadForStaleChunk } from "@/lib/staleChunkRecovery";

type RouteScreen = ComponentType;

export interface PreloadableScreen extends LazyExoticComponent<RouteScreen> {
  /** 화면 청크를 미리 받아 둔다. 여러 번 불러도 실제 요청은 한 번이다. */
  preload: () => Promise<void>;
}

/** named export 화면을 React.lazy가 요구하는 default export 형태로 연결한다. */
export function lazyScreen<TModule extends object, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
): PreloadableScreen {
  let started: Promise<TModule> | null = null;
  const load = (): Promise<TModule> => {
    if (!started) {
      started = loader().catch((error: unknown) => {
        // 실패한 약속을 남겨 두면 실제 이동에서도 영영 실패한다 — 다음 시도에 다시 받는다.
        started = null;
        throw error;
      });
    }
    return started;
  };

  const screen = lazy(async () => {
    let loaded: TModule;
    try {
      loaded = await load();
    } catch (error) {
      // 배포 뒤 옛 청크면 새 번들을 받는 동안 로딩 표시를 유지한다. 미리 받기에서는 하지 않는다.
      if (reloadForStaleChunk(error)) return new Promise<never>(() => undefined);
      throw error;
    }
    return { default: loaded[exportName] as RouteScreen };
  }) as PreloadableScreen;

  // 미리 받기 실패는 화면 진입을 막지 않는다(그때 다시 받는다).
  screen.preload = () => load().then(() => undefined, () => undefined);
  return screen;
}
