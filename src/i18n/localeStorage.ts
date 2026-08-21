import {
  isSupportedLocale,
  isSupportedLocaleInput,
  normalizeLocale,
  type SupportedLocale,
} from "./locale.ts";
import {
  accessCountryFromClientHints,
  localeForAccessCountry,
} from "../transform/accessCountry.ts";

export const LOCALE_STORAGE_KEY = "hyeni-locale-v1";

export interface LocaleStoragePort {
  read(): string | null;
  write(locale: SupportedLocale): void;
}

export function resolveWebLocale(args: {
  storedLocale: string | null;
  navigatorLanguages: readonly string[];
  timeZone?: string | null;
}): SupportedLocale {
  if (args.storedLocale !== null && isSupportedLocale(args.storedLocale)) {
    return args.storedLocale;
  }

  const timeZoneCountry = accessCountryFromClientHints({
    timeZone: args.timeZone,
    navigatorLanguages: [],
  });
  if (timeZoneCountry !== "ZZ") return localeForAccessCountry(timeZoneCountry);

  for (const navigatorLocale of args.navigatorLanguages) {
    if (isSupportedLocaleInput(navigatorLocale)) {
      return normalizeLocale(navigatorLocale);
    }
  }

  return "en";
}
