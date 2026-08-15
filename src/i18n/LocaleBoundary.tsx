import { useEffect, useState, type ReactNode } from "react";
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
  const { locale, ensureNamespaces, readyNamespaces } = useLocale();
  const acquireNamespaceLease = useLocaleBoundaryLease();
  const [loadError, setLoadError] = useState<unknown>(null);
  const namespaceKey = namespaces.join("\u0000");
  const ready = namespaces.every((namespace) => readyNamespaces.has(namespace));

  useEffect(() => {
    const releaseLease = acquireNamespaceLease(namespaces);
    let active = true;
    setLoadError(null);
    ensureNamespaces(namespaces).catch((error: unknown) => {
      if (active) setLoadError(error);
    });
    return () => {
      active = false;
      releaseLease();
    };
  }, [acquireNamespaceLease, ensureNamespaces, locale, namespaceKey, namespaces]);

  if (loadError) throw loadError;
  return ready ? children : null;
}
