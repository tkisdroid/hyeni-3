/** Cloudflare cf.country 외의 값은 추측하지 않고 공개 unknown 코드로 닫는다. */
export function normalizeEdgeCountry(value: unknown): string {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country) || country === "XX" || country === "ZZ") return "ZZ";
  return country;
}
