import { useEffect, useState, type ReactNode } from "react";
import { RouteLoading } from "@/components/ui/RouteLoading";
import type { MessageNamespace } from "./generated/messageIds";
import { useLocaleBoundaryLease } from "./LocaleProvider";
import { useLocale } from "./useLocale";

export function LocaleBoundary({
  namespaces,
  children,
}: {
  namespaces: readonly MessageNamespace[];
  children: ReactNode;
}) {
  const { locale, readyNamespaces } = useLocale();
  const acquireNamespaceLease = useLocaleBoundaryLease();
  const [loadError, setLoadError] = useState<unknown>(null);
  const namespaceKey = namespaces.join("\u0000");
  const ready = namespaces.every((namespace) => readyNamespaces.has(namespace));

  useEffect(() => {
    const lease = acquireNamespaceLease(namespaces);
    let active = true;
    setLoadError(null);
    lease.ready.catch((error: unknown) => {
      if (active) setLoadError(error);
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [acquireNamespaceLease, locale, namespaceKey, namespaces]);

  if (loadError) throw loadError;
  // 문구를 받는 동안 빈 화면을 두면 "앱이 새로고침됐다"로 읽힌다(2026-08-18 TK 제보) —
  // 청크 로딩과 같은 표시를 써서 "불러오는 중"임을 알린다. core 문구는 boot 에서 이미 준비된다.
  return ready ? children : <RouteLoading />;
}
