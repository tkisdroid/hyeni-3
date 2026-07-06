/**
 * 네이티브 플러그인 접근 기반(hyeni-1 nativePlugins.js 이관).
 * Capacitor 네이티브(Android)에서만 플러그인을 등록/반환, 웹에선 null → 화면이 폴백.
 * 커스텀 플러그인(Java)은 android/ MainActivity 에 registerPlugin 으로 등록돼 있다.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type PluginShape = Record<string, (...args: any[]) => Promise<any>>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const cache = new Map<string, unknown>();

/** Android/iOS 네이티브 래핑 여부. 웹(PWA)에선 false. */
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** "android" | "ios" | "web". */
export function getPlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}

// `await getNativePlugin()` 이 'then' getter 로 매달리지 않도록 non-thenable 프록시.
function asNonThenable<T extends object>(plugin: T): T {
  return new Proxy(plugin, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined;
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * 커스텀 네이티브 플러그인 반환. 웹이거나 네이티브 아니면 null.
 * @example const loc = getNativePlugin<LocationPlugin>("LocationPlugin");
 */
export function getNativePlugin<T extends object = PluginShape>(name: string): T | null {
  if (!name || !isNativePlatform()) return null;
  const cached = cache.get(name);
  if (cached) return cached as T;
  const plugin = asNonThenable(registerPlugin<T>(name));
  cache.set(name, plugin);
  return plugin;
}
