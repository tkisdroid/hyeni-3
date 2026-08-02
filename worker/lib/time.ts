// D1 timestamp 형식 헬퍼.
// D1 이관 데이터의 timestamp 는 pg_dump COPY 형식 'YYYY-MM-DD HH:MM:SS.ffffff+00'
// (공백 구분, +00)이다. Worker write 가 new Date().toISOString()('...T...Z')을 그대로
// 쓰면 한 컬럼에 두 형식이 공존해 ORDER BY/범위비교가 깨진다(ISO 가 정렬상 항상 큼).
// pgNow() 는 이관 데이터와 동일한 '공백 + +00' 형식을 만들어 형식 일관성을 보장한다.
// pgTs(date) 는 임의 Date 를 같은 형식으로 변환(만료시각 등 미래 시각 표기용).
export function pgTs(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "+00");
}
export function pgNow(): string {
  return pgTs(new Date());
}

/** 고정 일수 근사 없이 UTC 달력 기준으로 연 단위 보존 만료일을 계산한다. */
export function addUtcCalendarYears(date: Date, years: number): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isInteger(years)) {
    throw new Error("calendar_year_input_invalid");
  }
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

// ISO('...T..Z') → D1 비교형('YYYY-MM-DD HH:MM:SS', UTC). 앞 19자만 잘라 UTC 동일 형식.
export function tsNorm(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

// D1 pg COPY timestamp('YYYY-MM-DD HH:MM:SS.ffffff+00', 공백 구분) → Date.parse 안전한 ISO.
// V8 Date.parse 는 공백 구분 + bare '+00' offset 을 신뢰성 없게 파싱한다(time.ts 상단 함정).
// 이 함수로 'T' 구분 + '+00'→'+00:00' / '+0000'→'+00:00' / offset 없음→'Z' 로 정규화한다.
// 이미 ISO('...T...Z' 또는 '...+09:00')면 그대로 통과(idempotent).
export function pgToIso(ts: string | null | undefined): string {
  const raw = String(ts ?? "").trim();
  if (!raw) return raw;
  let s = raw.replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) {
    s = s + ":00"; // '+00' → '+00:00'
  } else if (/[+-]\d{4}$/.test(s)) {
    s = s.slice(0, -2) + ":" + s.slice(-2); // '+0000' → '+00:00'
  } else if (!/[+-]\d{2}:\d{2}$/.test(s) && !s.endsWith("Z")) {
    s = s + "Z"; // offset 없음 → UTC
  }
  return s;
}

// D1 timestamp → epoch ms(UTC). 파싱 불가/빈값이면 NaN.
export function pgToMs(ts: string | null | undefined): number {
  const iso = pgToIso(ts);
  return iso ? Date.parse(iso) : NaN;
}
