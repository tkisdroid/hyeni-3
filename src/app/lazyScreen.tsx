import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type RouteScreen = ComponentType;

/** named export 화면을 React.lazy가 요구하는 default export 형태로 연결한다. */
export function lazyScreen<TModule extends object, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
): LazyExoticComponent<RouteScreen> {
  return lazy(async () => {
    const loaded = await loader();
    return { default: loaded[exportName] as RouteScreen };
  });
}
