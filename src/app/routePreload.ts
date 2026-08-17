/**
 * 화면 청크 미리 받기 등록소(2026-08-18 TK 제보 "탭을 처음 누르면 화면이 한 번 새로 뜬다").
 *
 * 각 화면은 route 단위로 나뉜 청크라 처음 들어갈 때 "화면을 불러오는 중"이 한 번 보인다.
 * 탭처럼 곧 누를 게 뻔한 목적지는 미리 받아 두면 그 장면이 사라진다.
 *
 * 등록은 App 이 화면을 정의하는 곳에서 하고(경로 문자열 중복 정의 방지),
 * 소비는 탭바·독이 한다. 사이에 import 순환이 없도록 이 모듈은 아무 것도 import 하지 않는다.
 */
type Preloader = () => Promise<void>;

const preloaders = new Map<string, Preloader>();

export function registerRoutePreload(path: string, preload: Preloader): void {
  preloaders.set(path, preload);
}

/** 등록된 경로면 미리 받는다. 등록이 없으면 조용히 넘어간다(느려질 뿐 깨지지 않는다). */
export function preloadRoute(path: string): void {
  void preloaders.get(path)?.();
}

export function preloadRoutes(paths: readonly string[]): void {
  for (const path of paths) preloadRoute(path);
}

/** 테스트·진단용 — 등록된 경로 목록. */
export function registeredPreloadRoutes(): string[] {
  return [...preloaders.keys()];
}

/**
 * 지금 하는 일이 끝난 뒤 한가할 때 미리 받는다.
 * 첫 화면 렌더와 경쟁하면 오히려 느려지므로 requestIdleCallback 을 쓴다.
 */
export function preloadRoutesWhenIdle(paths: readonly string[]): () => void {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof idle === "function") {
    const handle = idle(() => preloadRoutes(paths), { timeout: 3_000 });
    const cancel = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
    return () => cancel?.(handle);
  }
  const timer = setTimeout(() => preloadRoutes(paths), 1_200);
  return () => clearTimeout(timer);
}
