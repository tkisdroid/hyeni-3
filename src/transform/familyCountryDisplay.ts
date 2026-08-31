export function formatFamilyCountryName(countryCode: string, locale: string): string {
  const normalized = countryCode.trim().toUpperCase();
  const code = /^[A-Z]{2}$/u.test(normalized) ? normalized : "ZZ";
  if (typeof Intl.DisplayNames !== "function") return code;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
