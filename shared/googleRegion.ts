function normalizeCountry(countryCode: string): string {
  const value = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(value)) throw new Error("google_region_invalid");
  return value;
}

/** Maps JavaScript API의 Unicode region 형식. */
export function googleJsRegion(countryCode: string): string {
  return normalizeCountry(countryCode);
}

/** Places·Geocoding v4의 CLDR region 형식. */
export function googleServiceRegion(countryCode: string): string {
  return normalizeCountry(countryCode).toLowerCase();
}

/** Routes v2의 ccTLD region 형식. */
export function googleRoutesRegion(countryCode: string): string {
  const country = normalizeCountry(countryCode);
  return country === "GB" ? "uk" : country.toLowerCase();
}

