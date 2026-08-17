import type { SupportedLocale } from "../i18n/locale.ts";

interface FamilyConnectionChildSubjectInput {
  childName: string | null | undefined;
  locale: SupportedLocale;
  childFallback: string;
  particleConsonant: string;
  particleVowel: string;
}

function hasKoreanFinalConsonant(value: string): boolean {
  const last = value.trim().at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/** 연결된 아이가 없어도 안전한 이름을 만들고 한국어에서만 주격 조사를 붙인다. */
export function resolveFamilyConnectionChildSubject(
  input: FamilyConnectionChildSubjectInput,
): string {
  const name = input.childName?.trim() || input.childFallback;
  if (input.locale !== "ko") return name;
  return `${name}${hasKoreanFinalConsonant(name) ? input.particleConsonant : input.particleVowel}`;
}
