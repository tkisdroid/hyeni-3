const TRUSTED_CORS_ORIGINS = new Set([
  "https://hyeni-calendar.pages.dev",
  "https://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export function resolveCorsOrigin(origin: string): string | undefined {
  const normalized = origin.trim();
  return TRUSTED_CORS_ORIGINS.has(normalized) ? normalized : undefined;
}
