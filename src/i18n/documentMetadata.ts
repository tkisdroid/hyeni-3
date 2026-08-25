/**
 * 문서 수준 locale metadata 정본.
 *
 * 화면 안 문구는 catalog 가 담당하지만, **문서 바깥**(`<html lang>`, `<title>`,
 * `meta[name=description]`, `link[rel=manifest]`)은 React 트리 밖이라 따로 갱신해야 한다.
 * 이 네 곳이 어긋나면 설치된 PWA 이름·검색 요약·보조기술 언어가 화면과 다른 언어로 남는다.
 *
 * 순수하게 유지하는 이유: 테스트가 실제 DOM 없이 대상 객체를 넘겨 검증할 수 있어야 한다.
 */
import type { CatalogMessages } from "./generated/messageIds";
import {
  localeDirection,
  localizedBrandName,
  type SupportedLocale,
} from "./locale";

export interface LocaleMetadata {
  /** 문서 title 과 apple-mobile-web-app-title 에 함께 쓰는 브랜드. */
  title: string;
  /** meta[name=description]. */
  description: string;
  /** link[rel=manifest] 의 href(앱 루트 기준 상대 경로). */
  manifestHref: string;
}

export interface DocumentMetadataTarget {
  documentElement: { lang: string; dir: string };
  title: string;
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

/**
 * manifest 는 `public/manifests/` 안에 있고 문서는 앱 루트에 있다.
 * `base: "./"`(Capacitor `file://` 호환)를 유지하려면 절대 경로를 쓸 수 없다.
 */
export function localeManifestHref(locale: SupportedLocale): string {
  return `./manifests/manifest.${locale}.webmanifest`;
}

/**
 * core catalog 이 있으면 번역 문구를, 없으면(부트스트랩 단계) 브랜드만 쓴다.
 * 설명은 지어내지 않는다 — 없으면 갱신하지 않고 index.html 의 값을 남긴다.
 */
export function resolveLocaleMetadata(
  locale: SupportedLocale,
  coreMessages?: CatalogMessages,
): LocaleMetadata {
  return {
    title: coreMessages?.["core.brand.name"] ?? localizedBrandName(locale),
    description: coreMessages?.["core.brand.description"] ?? "",
    manifestHref: localeManifestHref(locale),
  };
}

export function applyDocumentLocale(
  locale: SupportedLocale,
  metadata: LocaleMetadata,
  target?: DocumentMetadataTarget,
): void {
  const documentTarget = target ?? (typeof document === "undefined" ? undefined : document);
  if (!documentTarget) return;

  documentTarget.documentElement.lang = locale;
  documentTarget.documentElement.dir = localeDirection(locale);
  documentTarget.title = metadata.title;
  documentTarget.querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", metadata.title);
  if (metadata.description) {
    documentTarget.querySelector("#hyeni-description")
      ?.setAttribute("content", metadata.description);
  }
  documentTarget.querySelector("#hyeni-manifest")
    ?.setAttribute("href", metadata.manifestHref);
}
