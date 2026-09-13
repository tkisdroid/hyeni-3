import type { SupportedLocale } from '@/i18n/locale';

export function createNativeLocaleSyncScheduler(
  writeLocale: (locale: SupportedLocale) => Promise<void>,
  onError: () => void,
) {
  let pendingLocale: SupportedLocale | null = null;
  let drainPromise: Promise<void> | null = null;

  const drain = async () => {
    try {
      while (pendingLocale !== null) {
        const locale = pendingLocale;
        pendingLocale = null;
        try {
          await writeLocale(locale);
        } catch {
          onError();
        }
      }
    } finally {
      drainPromise = null;
    }
  };

  const ensureDrain = (): Promise<void> => {
    if (drainPromise) return drainPromise;
    drainPromise = drain();
    return drainPromise;
  };

  return {
    request(locale: SupportedLocale): Promise<void> {
      pendingLocale = locale;
      return ensureDrain();
    },
  };
}
