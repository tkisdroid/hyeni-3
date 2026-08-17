import {
  isSupportedLocale,
  isSupportedLocaleInput,
  normalizeLocale,
  type SupportedLocale,
} from "./locale.ts";

export const LOCALE_STORAGE_KEY = "hyeni-locale-v1";

export interface LocaleStoragePort {
  read(): string | null;
  write(locale: SupportedLocale): void;
}

export function resolveWebLocale(args: {
  storedLocale: string | null;
  navigatorLanguages: readonly string[];
}): SupportedLocale {
  if (args.storedLocale !== null && isSupportedLocale(args.storedLocale)) {
    return args.storedLocale;
  }

  for (const navigatorLocale of args.navigatorLanguages) {
    if (isSupportedLocaleInput(navigatorLocale)) {
      return normalizeLocale(navigatorLocale);
    }
  }

  return "en";
}
